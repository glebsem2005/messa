export interface Wallet {
  id: string;
  type: WalletType;
  name: string;
  address: string;
  balance: Balance;
  createdAt: Date;
  lastSync: Date;
  isDefault: boolean;
}

export type WalletType = 'BTC' | 'XMR' | 'ZEC';

export interface Balance {
  confirmed: string;
  unconfirmed: string;
  total: string;
  currency: string;
  usdValue?: number;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: 'send' | 'receive';
  amount: string;
  fee: string;
  from: string;
  to: string;
  status: TransactionStatus;
  confirmations: number;
  timestamp: Date;
  memo?: string;
  metadata?: Record<string, any>;
}

export type TransactionStatus = 
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export interface WalletConfig {
  mnemonic?: string;
  privateKey?: string;
  password?: string;
  derivationPath?: string;
  network?: 'mainnet' | 'testnet';
}

export interface SendTransactionParams {
  walletId: string;
  to: string;
  amount: string;
  fee?: string;
  memo?: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface Price {
  currency: string;
  usd: number;
  change24h: number;
  lastUpdate: Date;
}

export interface IWalletService {
  createWallet(type: WalletType, config?: WalletConfig): Promise<Wallet>;
  importWallet(type: WalletType, config: WalletConfig): Promise<Wallet>;
  getWallet(id: string): Promise<Wallet | null>;
  getWallets(): Promise<Wallet[]>;
  deleteWallet(id: string): Promise<void>;
  
  getBalance(walletId: string): Promise<Balance>;
  syncWallet(walletId: string): Promise<void>;
  
  sendTransaction(params: SendTransactionParams): Promise<Transaction>;
  getTransaction(id: string): Promise<Transaction | null>;
  getTransactions(walletId: string): Promise<Transaction[]>;
  
  generateAddress(walletId: string): Promise<string>;
  validateAddress(address: string, type: WalletType): boolean;
  
  exportPrivateKey(walletId: string, password: string): Promise<string>;
  exportMnemonic(walletId: string, password: string): Promise<string>;
}

export interface ICryptoWallet {
  generateWallet(): Promise<{ address: string; privateKey: string; mnemonic?: string }>;
  importFromPrivateKey(privateKey: string): Promise<{ address: string }>;
  importFromMnemonic(mnemonic: string, derivationPath?: string): Promise<{ address: string; privateKey: string }>;
  
  getBalance(address: string): Promise<Balance>;
  sendTransaction(privateKey: string, to: string, amount: string, fee?: string): Promise<string>;
  getTransaction(txId: string): Promise<any>;
  
  validateAddress(address: string): boolean;
  estimateFee(priority: 'low' | 'medium' | 'high'): Promise<string>;
}

export interface IPriceService {
  getPrice(currency: string): Promise<Price>;
  getPrices(currencies: string[]): Promise<Map<string, Price>>;
  subscribeToPrice(currency: string, callback: (price: Price) => void): () => void;
  convertToUSD(amount: string, currency: string): Promise<number>;
}
