import Database from 'better-sqlite3';
import sodium from 'libsodium-wrappers';
import { SQL } from 'sql-template-strings';
import type { 
  IDatabaseService, 
  DatabaseConfig, 
  QueryResult, 
  Migration,
  BackupOptions 
} from '../types';
import { EncryptedStorage } from './EncryptedStorage';

export class DatabaseService implements IDatabaseService {
  private db: Database.Database | null = null;
  private encryptionKey: Uint8Array | null = null;
  private encryptedStorage: EncryptedStorage;
  private config: DatabaseConfig = {};

  constructor() {
    this.encryptedStorage = new EncryptedStorage();
  }

  async initialize(config: DatabaseConfig): Promise<void> {
    await sodium.ready;
    this.config = config;

    const dbPath = config.inMemory ? ':memory:' : (config.path || 'messa.db');
    
    this.db = new Database(dbPath, {
      readonly: config.readOnly || false,
      fileMustExist: false,
      timeout: 5000,
      verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
    });

    // Настройка SQLite
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('secure_delete = ON');

    // Инициализация шифрованного хранилища
    if (config.encryptionKey) {
      this.encryptionKey = config.encryptionKey;
      await this.encryptedStorage.initialize(this.db, config.encryptionKey);
    }

    // Создание системных таблиц
    this.createSystemTables();
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  execute(sql: string, params: any[] = []): QueryResult {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);

    return {
      rows: [],
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  query<T = any>(sql: string, params: any[] = []): T[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  get<T = any>(sql: string, params: any[] = []): T | undefined {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.transaction(fn)();
  }

  prepare(sql: string): any {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.prepare(sql);
  }

  async migrate(migrations: Migration[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const currentVersion = this.getCurrentVersion();
    const pendingMigrations = migrations.filter(m => m.version > currentVersion);

    if (pendingMigrations.length === 0) {
      console.log('Database is up to date');
      return;
    }

    // Сортировка по версии
    pendingMigrations.sort((a, b) => a.version - b.version);

    this.transaction(() => {
      for (const migration of pendingMigrations) {
        console.log(`Running migration ${migration.version}`);
        
        // Выполнение миграции
        this.db!.exec(migration.up);
        
        // Обновление версии
        this.execute(
          'INSERT INTO migrations (version, applied_at) VALUES (?, ?)',
          [migration.version, new Date().toISOString()]
        );
      }
    });

    console.log(`Applied ${pendingMigrations.length} migrations`);
  }

  getCurrentVersion(): number {
    const result = this.get<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    return result?.version || 0;
  }

  async backup(path: string, options: BackupOptions = {}): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Создание резервной копии
    const backupDb = new Database(path);
    
    try {
      await this.db.backup(backupDb);

      if (options.encrypt && this.encryptionKey) {
        // Шифрование резервной копии
        backupDb.close();
        await this.encryptBackupFile(path, this.encryptionKey);
      }

      if (options.includeMetadata) {
        // Добавление метаданных
        const metadata = {
          createdAt: new Date().toISOString(),
          version: this.getCurrentVersion(),
          encrypted: options.encrypt || false,
        };

        await this.encryptedStorage.set('backup_metadata', metadata);
      }
    } finally {
      if (backupDb.open) {
        backupDb.close();
      }
    }
  }

  async restore(path: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Проверка, зашифрован ли файл
    const isEncrypted = await this.isBackupEncrypted(path);
    
    if (isEncrypted && this.encryptionKey) {
      // Расшифровка резервной копии
      await this.decryptBackupFile(path, this.encryptionKey);
    }

    const backupDb = new Database(path, { readonly: true });
    
    try {
      // Очистка текущей БД
      this.db.exec('PRAGMA writable_schema = 1');
      this.db.exec('DELETE FROM sqlite_master WHERE type IN ("table", "index", "trigger")');
      this.db.exec('PRAGMA writable_schema = 0');
      this.db.exec('VACUUM');

      // Восстановление из резервной копии
      await backupDb.backup(this.db);
    } finally {
      backupDb.close();
    }
  }

  async encrypt(key: Uint8Array): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    if (this.encryptionKey) {
      throw new Error('Database is already encrypted');
    }

    // Создание временной зашифрованной копии
    const tempPath = `${this.config.path}.encrypted`;
    const encryptedDb = new Database(tempPath);

    try {
      // Копирование структуры и данных
      await this.db.backup(encryptedDb);
      encryptedDb.close();

      // Шифрование файла
      await this.encryptDatabaseFile(tempPath, key);

      // Замена оригинального файла
      if (this.config.path) {
        const fs = await import('fs/promises');
        await fs.rename(tempPath, this.config.path);
      }

      this.encryptionKey = key;
    } catch (error) {
      // Очистка в случае ошибки
      try {
        const fs = await import('fs/promises');
        await fs.unlink(tempPath);
      } catch {}
      
      throw error;
    }
  }

  async decrypt(key: Uint8Array): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    if (!this.encryptionKey) {
      throw new Error('Database is not encrypted');
    }

    // Проверка ключа
    if (!this.verifyEncryptionKey(key)) {
      throw new Error('Invalid decryption key');
    }

    // Создание временной расшифрованной копии
    const tempPath = `${this.config.path}.decrypted`;
    
    try {
      // Расшифровка файла
      await this.decryptDatabaseFile(this.config.path!, key, tempPath);

      // Замена оригинального файла
      if (this.config.path) {
        const fs = await import('fs/promises');
        await fs.rename(tempPath, this.config.path);
      }

      this.encryptionKey = null;
    } catch (error) {
      // Очистка в случае ошибки
      try {
        const fs = await import('fs/promises');
        await fs.unlink(tempPath);
      } catch {}
      
      throw error;
    }
  }

  async changeEncryptionKey(oldKey: Uint8Array, newKey: Uint8Array): Promise<void> {
    if (!this.encryptionKey) {
      throw new Error('Database is not encrypted');
    }

    if (!this.verifyEncryptionKey(oldKey)) {
      throw new Error('Invalid old encryption key');
    }

    // Расшифровка с старым ключом
    await this.decrypt(oldKey);
    
    // Шифрование с новым ключом
    await this.encrypt(newKey);
  }

  private createSystemTables(): void {
    if (!this.db) return;

    // Таблица миграций
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    // Таблица для зашифрованного хранилища
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS encrypted_storage (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL,
        nonce BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Таблица метаданных
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  private async encryptDatabaseFile(path: string, key: Uint8Array): Promise<void> {
    const fs = await import('fs/promises');
    const data = await fs.readFile(path);
    
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(data, nonce, key);
    
    const result = new Uint8Array(nonce.length + encrypted.length);
    result.set(nonce);
    result.set(encrypted, nonce.length);
    
    await fs.writeFile(path, result);
  }

  private async decryptDatabaseFile(
    path: string, 
    key: Uint8Array, 
    outputPath: string
  ): Promise<void> {
    const fs = await import('fs/promises');
    const data = await fs.readFile(path);
    
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = data.slice(0, nonceLength);
    const encrypted = data.slice(nonceLength);
    
    const decrypted = sodium.crypto_secretbox_open_easy(encrypted, nonce, key);
    
    await fs.writeFile(outputPath, decrypted);
  }

  private async encryptBackupFile(path: string, key: Uint8Array): Promise<void> {
    await this.encryptDatabaseFile(path, key);
  }

  private async decryptBackupFile(path: string, key: Uint8Array): Promise<void> {
    const tempPath = `${path}.decrypted`;
    await this.decryptDatabaseFile(path, key, tempPath);
    
    const fs = await import('fs/promises');
    await fs.rename(tempPath, path);
  }

  private async isBackupEncrypted(path: string): Promise<boolean> {
    const fs = await import('fs/promises');
    const data = await fs.readFile(path);
    
    // Проверка SQLite заголовка
    const sqliteHeader = Buffer.from('SQLite format 3\0');
    return !data.slice(0, 16).equals(sqliteHeader);
  }

  private verifyEncryptionKey(key: Uint8Array): boolean {
    // Проверка ключа путем попытки расшифровки тестовых данных
    try {
      const testData = this.encryptedStorage.get('encryption_test');
      return testData !== null;
    } catch {
      return false;
    }
  }

  // Вспомогательные методы для работы с данными

  async insertSecure(table: string, data: Record<string, any>): Promise<number> {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?').join(', ');
    
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    const result = this.execute(sql, values);
    
    return Number(result.lastInsertRowid);
  }

  async updateSecure(
    table: string, 
    data: Record<string, any>, 
    where: Record<string, any>
  ): Promise<number> {
    const setColumns = Object.keys(data).map(col => `${col} = ?`).join(', ');
    const whereColumns = Object.keys(where).map(col => `${col} = ?`).join(' AND ');
    
    const sql = `UPDATE ${table} SET ${setColumns} WHERE ${whereColumns}`;
    const values = [...Object.values(data), ...Object.values(where)];
    
    const result = this.execute(sql, values);
    return result.changes;
  }

  async deleteSecure(table: string, where: Record<string, any>): Promise<number> {
    const whereColumns = Object.keys(where).map(col => `${col} = ?`).join(' AND ');
    const sql = `DELETE FROM ${table} WHERE ${whereColumns}`;
    
    const result = this.execute(sql, Object.values(where));
    return result.changes;
  }
}
