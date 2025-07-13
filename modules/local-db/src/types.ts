export interface DatabaseConfig {
  path?: string;
  encryptionKey?: Uint8Array;
  inMemory?: boolean;
  readOnly?: boolean;
}

export interface QueryResult<T = any> {
  rows: T[];
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Migration {
  version: number;
  up: string;
  down: string;
}

export interface BackupOptions {
  compress?: boolean;
  encrypt?: boolean;
  includeMetadata?: boolean;
}

export interface IDatabaseService {
  initialize(config: DatabaseConfig): Promise<void>;
  close(): Promise<void>;
  
  // Основные операции
  execute(sql: string, params?: any[]): QueryResult;
  query<T = any>(sql: string, params?: any[]): T[];
  get<T = any>(sql: string, params?: any[]): T | undefined;
  
  // Транзакции
  transaction<T>(fn: () => T): T;
  prepare(sql: string): any;
  
  // Миграции
  migrate(migrations: Migration[]): Promise<void>;
  getCurrentVersion(): number;
  
  // Резервное копирование
  backup(path: string, options?: BackupOptions): Promise<void>;
  restore(path: string): Promise<void>;
  
  // Шифрование
  encrypt(key: Uint8Array): Promise<void>;
  decrypt(key: Uint8Array): Promise<void>;
  changeEncryptionKey(oldKey: Uint8Array, newKey: Uint8Array): Promise<void>;
}

export interface IEncryptedStorage {
  set(key: string, value: any): Promise<void>;
  get<T = any>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export interface TableSchema {
  name: string;
  columns: ColumnDefinition[];
  indexes?: IndexDefinition[];
  constraints?: ConstraintDefinition[];
}

export interface ColumnDefinition {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'JSON';
  primaryKey?: boolean;
  autoIncrement?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: any;
  check?: string;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique?: boolean;
  where?: string;
}

export interface ConstraintDefinition {
  name: string;
  type: 'FOREIGN KEY' | 'CHECK' | 'UNIQUE';
  definition: string;
}
