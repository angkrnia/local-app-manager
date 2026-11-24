import { safeStorage } from 'electron'
import { AppError, ErrorCode } from '@shared/errors'

const ENCRYPTED_PREFIX = 'enc:v1:'

/**
 * Abstraction over OS-backed secret encryption. Tests use the plain codec,
 * production uses Electron safeStorage (DPAPI on Windows).
 */
export interface SecretCodec {
  readonly available: boolean
  encrypt(value: string): string
  decrypt(value: string): string
  isEncrypted(value: string): boolean
}

export class ElectronSecretCodec implements SecretCodec {
  get available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX)
  }

  encrypt(value: string): string {
    if (!this.available) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'Windows secure storage is unavailable, so the secret cannot be stored safely.'
      )
    }
    return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64')
  }

  decrypt(value: string): string {
    if (!this.isEncrypted(value)) return value
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
    } catch {
      throw new AppError(
        ErrorCode.INTERNAL,
        'A stored secret could not be decrypted. Re-enter the value in the application settings.'
      )
    }
  }
}

/** Used by automated tests where Electron safeStorage is not available. */
export class PlainSecretCodec implements SecretCodec {
  readonly available = true

  isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX)
  }

  encrypt(value: string): string {
    return ENCRYPTED_PREFIX + Buffer.from(value, 'utf8').toString('base64')
  }

  decrypt(value: string): string {
    if (!this.isEncrypted(value)) return value
    return Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64').toString('utf8')
  }
}
