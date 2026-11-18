import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  WorkspaceAuthMethod,
  WorkspaceSummary,
} from '../../core/common/types';
import {
  ApiError,
  apiClient,
  isPlatformBiometricAvailable,
  runBrowserWebAuthnAssertion,
} from '../../core/network/apiClient';

interface WorkspaceModalProps {
  mode: 'create' | 'unlock' | null;
  targetWorkspace: WorkspaceSummary | null;
  onClose: () => void;
  onCreateWorkspace: (payload: {
    displayName: string;
    passphrase: string;
    authMethod: Exclude<WorkspaceAuthMethod, 'none'>;
    autoLockMinutes: number;
  }) => Promise<void>;
  onUnlockWorkspace: (
    workspaceId: string,
    payload: { passphrase?: string; challengeId?: string; assertion?: unknown },
  ) => Promise<void>;
  onSwitchToDefault?: () => void;
}

export function WorkspaceModal({
  mode,
  targetWorkspace,
  onClose,
  onCreateWorkspace,
  onUnlockWorkspace,
  onSwitchToDefault,
}: WorkspaceModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [biometricSupported, setBiometricSupported] = useState(false);

  const resetSensitiveFields = () => {
    setPassphrase('');
    setConfirmPassphrase('');
    setShowPass(false);
  };

  useEffect(() => {
    if (!mode) return;
    setDisplayName('');
    resetSensitiveFields();
    setAutoLockMinutes(5);
    setErrorMsg(null);
    setCooldownSeconds(0);
    setSubmitting(false);

    void isPlatformBiometricAvailable().then(setBiometricSupported);
  }, [mode, targetWorkspace?.id]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetSensitiveFields();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  if (!mode) return null;

  const handleClose = () => {
    resetSensitiveFields();
    onClose();
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!displayName.trim()) {
      setErrorMsg('Please enter a workspace name.');
      return;
    }
    const normalized = passphrase.normalize('NFC');
    if (Array.from(normalized).length < 8) {
      setErrorMsg('Passphrase must be at least 8 characters long.');
      return;
    }
    if (normalized.length > 1024) {
      setErrorMsg('Passphrase must not exceed 1024 characters.');
      return;
    }
    if (normalized !== confirmPassphrase.normalize('NFC')) {
      setErrorMsg('Passphrases do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateWorkspace({
        displayName: displayName.trim(),
        passphrase: normalized,
        authMethod: 'passphrase',
        autoLockMinutes,
      });
      resetSensitiveFields();
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to create workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitUnlockPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetWorkspace || cooldownSeconds > 0) return;
    setErrorMsg(null);

    if (!passphrase) {
      setErrorMsg('Enter your workspace passphrase to unwrap encryption keys.');
      return;
    }

    setSubmitting(true);
    try {
      let webauthnProof:
        | { challengeId: string; assertion: unknown }
        | undefined;

      if (
        targetWorkspace.authMethod === 'both' &&
        targetWorkspace.hasBiometricCredential
      ) {
        if (!biometricSupported) {
          throw new Error(
            'This workspace requires platform biometric verification, which is unavailable on this browser.',
          );
        }
        const opts = await apiClient.getWebAuthnAuthOptions(
          'auth',
          targetWorkspace.id,
        );
        if (opts.allowCredentialIds.length === 0) {
          throw new Error('No registered passkey found for this workspace.');
        }
        const assertion = await runBrowserWebAuthnAssertion(opts);
        webauthnProof = { challengeId: opts.challengeId, assertion };
      }

      await onUnlockWorkspace(targetWorkspace.id, {
        passphrase,
        ...(webauthnProof ?? {}),
      });
      resetSensitiveFields();
      onClose();
    } catch (err) {
      resetSensitiveFields();
      if (err instanceof ApiError && err.retryAfterSeconds) {
        setCooldownSeconds(err.retryAfterSeconds);
      }
      setErrorMsg((err as Error).message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBiometricUnlock = async () => {
    if (!targetWorkspace || cooldownSeconds > 0) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const opts = await apiClient.getWebAuthnAuthOptions(
        'auth',
        targetWorkspace.id,
      );
      if (opts.allowCredentialIds.length === 0) {
        throw new Error('No biometric passkey is registered for this workspace.');
      }
      const assertion = await runBrowserWebAuthnAssertion(opts);
      await onUnlockWorkspace(targetWorkspace.id, {
        challengeId: opts.challengeId,
        assertion,
      });
      resetSensitiveFields();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSeconds) {
        setCooldownSeconds(err.retryAfterSeconds);
      }
      setErrorMsg(
        (err as Error).message || 'Biometric authentication failed.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canUseBiometricUnlock = Boolean(
    targetWorkspace &&
      targetWorkspace.authMethod === 'biometric' &&
      targetWorkspace.hasBiometricCredential &&
      biometricSupported,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E3DDD1] bg-[#FBF9F5] p-6 shadow-2xl dark:border-[#1E324D] dark:bg-[#0B192C]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between border-b border-[#E3DDD1] pb-4 dark:border-[#1E324D]">
          <div className="flex items-center gap-2.5">
            {mode === 'create' ? (
              <ShieldCheck className="h-5 w-5 text-[#B0893E]" aria-hidden="true" />
            ) : (
              <Lock className="h-5 w-5 text-[#B0893E]" aria-hidden="true" />
            )}
            <h2
              id="workspace-modal-title"
              className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]"
            >
              {mode === 'create'
                ? 'New Private Workspace'
                : `Unlock ${targetWorkspace?.displayName ?? 'Workspace'}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close workspace dialog"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#5C6470] hover:bg-[#EFEAE0] dark:text-[#9AA6B8] dark:hover:bg-[#132844]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {mode === 'create' ? (
          <form onSubmit={handleSubmitCreate} className="space-y-4">
            <div className="rounded-xl border border-amber-300/80 bg-amber-50/90 p-3.5 text-xs leading-relaxed text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
                  aria-hidden="true"
                />
                <p>
                  <strong className="font-semibold">
                    No passphrase recovery:
                  </strong>{' '}
                  Subscriptions, articles, bookmarks, and history inside a private
                  workspace stay continuously encrypted with AES-256-GCM. You can
                  enroll a WebAuthn platform passkey after creation.
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="ws-display-name"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Workspace Display Name
              </label>
              <input
                id="ws-display-name"
                type="text"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Investigative Desk"
                className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
              />
            </div>

            <div>
              <label
                htmlFor="ws-passphrase"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Passphrase (8–1024 chars · Unicode, spaces &amp; emoji supported)
              </label>
              <div className="relative flex items-center">
                <input
                  id="ws-passphrase"
                  type={showPass ? 'text' : 'password'}
                  required
                  minLength={8}
                  maxLength={1024}
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a strong passphrase"
                  className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] pl-3 pr-11 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  aria-label={showPass ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-1 inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8]"
                >
                  {showPass ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="ws-passphrase-confirm"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Confirm Passphrase
              </label>
              <input
                id="ws-passphrase-confirm"
                type={showPass ? 'text' : 'password'}
                required
                minLength={8}
                maxLength={1024}
                autoComplete="new-password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="Re-enter passphrase"
                className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
              />
            </div>

            <div>
              <label
                htmlFor="ws-auto-lock"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Inactivity Auto-Lock
              </label>
              <select
                id="ws-auto-lock"
                value={autoLockMinutes}
                onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
              >
                <option value={1}>After 1 minute</option>
                <option value={5}>After 5 minutes</option>
                <option value={15}>After 15 minutes</option>
                <option value={30}>After 30 minutes</option>
                <option value={0}>Manual lock only</option>
              </select>
            </div>

            {errorMsg && (
              <p
                role="alert"
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
              >
                {errorMsg}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="min-h-[44px] rounded-lg border border-[#D8D0C0] px-4 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] rounded-lg bg-[#0B192C] px-5 py-2 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] disabled:opacity-60 dark:bg-[#B0893E] dark:text-[#0B192C]"
              >
                {submitting ? 'Provisioning Keys...' : 'Create Private Workspace'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitUnlockPassphrase} className="space-y-4">
            <p className="text-sm leading-relaxed text-[#4A5565] dark:text-[#B9C4D4]">
              {targetWorkspace?.authMethod === 'both'
                ? 'Passphrase and platform passkey verification are both required to open this workspace.'
                : 'Workspace records remain AES-256-GCM encrypted at rest. Authenticate to open a memory session.'}
            </p>

            {canUseBiometricUnlock && (
              <button
                type="button"
                disabled={submitting || cooldownSeconds > 0}
                onClick={() => void handleBiometricUnlock()}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-[#B0893E] bg-[#EFEAE0]/60 px-4 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] disabled:opacity-60 dark:bg-[#10233D] dark:text-[#D4AF6A] dark:hover:bg-[#172E4D]"
              >
                <Fingerprint className="h-4 w-4 text-[#B0893E]" aria-hidden="true" />
                <span>Unlock with Biometric Passkey</span>
              </button>
            )}

            <div>
              <label
                htmlFor="ws-unlock-passphrase"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                {targetWorkspace?.authMethod === 'biometric'
                  ? 'Backup Passphrase'
                  : 'Workspace Passphrase'}
              </label>
              <div className="relative flex items-center">
                <input
                  id="ws-unlock-passphrase"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter passphrase"
                  className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] pl-3 pr-11 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  aria-label={showPass ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-1 inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8]"
                >
                  {showPass ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {errorMsg && (
              <p
                role="alert"
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
              >
                {errorMsg}
                {cooldownSeconds > 0 ? ` (${cooldownSeconds}s remaining)` : ''}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              {onSwitchToDefault ? (
                <button
                  type="button"
                  onClick={() => {
                    onSwitchToDefault();
                    handleClose();
                  }}
                  className="min-h-[40px] text-xs font-semibold text-[#5C6470] underline-offset-4 hover:underline dark:text-[#9AA6B8]"
                >
                  Return to Default Workspace
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="min-h-[44px] rounded-lg border border-[#D8D0C0] px-4 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || cooldownSeconds > 0}
                  className="min-h-[44px] rounded-lg bg-[#0B192C] px-5 py-2 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] disabled:opacity-60 dark:bg-[#B0893E] dark:text-[#0B192C]"
                >
                  {cooldownSeconds > 0
                    ? `Wait ${cooldownSeconds}s`
                    : submitting
                      ? 'Verifying...'
                      : targetWorkspace?.authMethod === 'both' &&
                          targetWorkspace?.hasBiometricCredential
                        ? 'Verify Passphrase & Passkey'
                        : 'Unlock Workspace'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
