import { useState, useCallback, useEffect } from 'react';
import { IdentityService } from '../services/IdentityService';
import type { DID, BiometryAuthResult } from '../types';

interface UseBiometryAuthReturn {
  isAuthenticated: boolean;
  currentDID: DID | null;
  isLoading: boolean;
  error: string | null;
  register: (photoData: Uint8Array) => Promise<void>;
  authenticate: (photoData: Uint8Array) => Promise<void>;
  logout: () => void;
  exportIdentity: () => Promise<string>;
  importIdentity: (data: string) => Promise<void>;
}

export function useBiometryAuth(): UseBiometryAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentDID, setCurrentDID] = useState<DID | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identityService] = useState(() => new IdentityService());

  useEffect(() => {
    // Инициализация сервиса при монтировании
    identityService.initialize().catch(console.error);
  }, [identityService]);

  const register = useCallback(async (photoData: Uint8Array) => {
    setIsLoading(true);
    setError(null);

    try {
      // Создание нового DID
      const did = await identityService.createDID();
      
      // Привязка фото к DID
      await identityService.bindPhotoToDID(did.id, photoData);
      
      setCurrentDID(did);
      setIsAuthenticated(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [identityService]);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setCurrentDID(null);
    setError(null);
  }, []);

  const exportIdentity = useCallback(async (): Promise<string> => {
    if (!isAuthenticated || !currentDID) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    try {
      const exportData = await identityService.exportIdentity();
      return exportData;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Export failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [identityService, isAuthenticated, currentDID]);

  const importIdentity = useCallback(async (data: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await identityService.importIdentity(data);
      // После импорта нужно аутентифицироваться с фото
      setError('Please authenticate with your photo to complete import');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Import failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [identityService]);

  return {
    isAuthenticated,
    currentDID,
    isLoading,
    error,
    register,
    authenticate,
    logout,
    exportIdentity,
    importIdentity,
  };
} Error ? err.message : 'Registration failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [identityService]);

  const authenticate = useCallback(async (photoData: Uint8Array) => {
    setIsLoading(true);
    setError(null);

    try {
      const result: BiometryAuthResult = await identityService.authenticateWithPhoto(photoData);
      
      if (result.success && result.did) {
        setCurrentDID(result.did);
        setIsAuthenticated(true);
      } else {
        throw new Error(result.error || 'Authentication failed');
      }
    } catch (err) {
      const errorMessage = err instanceof
