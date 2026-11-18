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
  PrivateAccessStatus,
  WorkspaceSummary,
} from '../../core/common/types';
import {
  ApiError,
  apiClient,
  isPlatformBiometricAvailable,
  runBrowserWebAuthnAssertion,
} from '../../core/network/apiClient';

interface PrivateAuthModalProps {
  isOpen: boolean;
  accessStatus: PrivateAccessStatus;
  onClose: () => void;
  onAuthenticated: (result: {
    workspace: WorkspaceSummary;
    workspaces: WorkspaceSummary[];
  }) => void;
}

export function PrivateAuthModal({
  isOpen,
  accessStatus,
  onClose,
  onAuthenticated,
}: PrivateAuthModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [biometricSupported, setBiometricSupported] = useState(false);

  const clearFields = () => {
    setPassphrase('');
    setConfirmPassphrase('');
    setShowPass(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName('');
    clearFields();
    setErrorMsg(null);
    setCooldownSeconds(0);
    setSubmitting(false);
    void isPlatformBiometricAvailable().then(setBiometricSupported);
  }, [isOpen]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const t = window.setInterval(() => {
      setCooldownSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearFields();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleClose = () => {
    clearFields();
    onClose();
  };

  const handleFirstTimeCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!displayName.trim()) {
      setErrorMsg('Enter a workspace name.');
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
      const res = await apiClient.createWorkspace({
        displayName: displayName.trim(),
        passphrase: normalized,
        authMethod: 'passphrase',
        autoLockMinutes,
        issueDashboardToken: true,
      });
      clearFields();
      onAuthenticated({
        workspace: res.workspace,
        workspaces: res.workspaces,
      });
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to create workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEntryPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownSeconds > 0) return;
    setErrorMsg(null);
    if (!passphrase) {
      setErrorMsg('Enter a valid credential to continue.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.authenticatePrivateEntry({ passphrase });
      clearFields();
      onAuthenticated({
        workspace: res.workspace,
        workspaces: res.workspaces,
      });
    } catch (err) {
      clearFields();
      if (err instanceof ApiError && err.retryAfterSeconds) {
        setCooldownSeconds(err.retryAfterSeconds);
      }
      setErrorMsg(
        (err as Error).message || 'Authentication failed. Verify your credentials.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEntryWebAuthn = async () => {
    if (cooldownSeconds > 0) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const opts = await apiClient.getWebAuthnAuthOptions('dashboard');
      if (opts.allowCredentialIds.length === 0) {
        throw new Error('No biometric passkeys are enrolled yet.');
      }
      const assertion = await runBrowserWebAuthnAssertion(opts);
      const res = await apiClient.authenticatePrivateEntry({
        challengeId: opts.challengeId,
        assertion,
      });
      clearFields();
      onAuthenticated({
        workspace: res.workspace,
        workspaces: res.workspaces,
      });
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSeconds) {
        setCooldownSeconds(err.retryAfterSeconds);
      }
      setErrorMsg(
        (err as Error).message || 'Authentication failed. Verify your credentials.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const isFirstSetup = !accessStatus.hasPrivateWorkspaces;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-gate-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/75 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#E3DDD1] bg-[#FBF9F5] p-6 shadow-2xl dark:border-[#1E324D] dark:bg-[#0B192C]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between border-b border-[#E3DDD1] pb-4 dark:border-[#1E324D]">
          <div className="flex items-center gap-2.5">
            {isFirstSetup ? (
              <ShieldCheck className="h-5 w-5 text-[#B0893E]" aria-hidden="true" />
            ) : (
              <Lock className="h-5 w-5 text-[#B0893E]" aria-hidden="true" />
            )}
            <h2
              id="private-gate-title"
              className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]"
            >
              {isFirstSetup
                ? 'Initialize Private Workspace'
                : 'Private Access Verification'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close authentication dialog"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#5C6470] hover:bg-[#EFEAE0] dark:text-[#9AA6B8] dark:hover:bg-[#132844]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isFirstSetup ? (
          <form onSubmit={handleFirstTimeCreate} className="space-y-4">
            <div className="rounded-xl border border-amber-300/80 bg-amber-50/90 p-3.5 text-xs leading-relaxed text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
                  aria-hidden="true"
                />
                <p>
                  Create your first encrypted private workspace to enter the
                  Private Workspace Dashboard. Passphrases are never recoverable.
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="gate-ws-name"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Workspace Name
              </label>
              <input
                id="gate-ws-name"
                type="text"
                required
                autoFocus
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Research Desk"
                className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
              />
            </div>

            <div>
              <label
                htmlFor="gate-ws-pass"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Passphrase (min 8 chars · Unicode, spaces &amp; emoji supported)
              </label>
              <div className="relative flex items-center">
                <input
                  id="gate-ws-pass"
                  type={showPass ? 'text' : 'password'}
                  required
                  minLength={8}
                  maxLength={1024}
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter passphrase"
                  className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] pl-3 pr-11 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  aria-label={showPass ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-1 inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md text-[#5C6470] dark:text-[#9AA6B8]"
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
                htmlFor="gate-ws-confirm"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Confirm Passphrase
              </label>
              <input
                id="gate-ws-confirm"
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
                htmlFor="gate-ws-autolock"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Inactivity Auto-Lock
              </label>
              <select
                id="gate-ws-autolock"
                value={autoLockMinutes}
                onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
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
                className="min-h-[44px] rounded-lg border border-[#D8D0C0] px-4 text-xs font-semibold text-[#0B192C] dark:border-[#294366] dark:text-[#FBF9F5]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] rounded-lg bg-[#0B192C] px-5 text-xs font-semibold text-[#FBF9F5] disabled:opacity-60 dark:bg-[#B0893E] dark:text-[#0B192C]"
              >
                {submitting ? 'Creating...' : 'Create & Open Dashboard'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyEntryPassphrase} className="space-y-4">
            <p className="text-sm leading-relaxed text-[#4A5565] dark:text-[#B9C4D4]">
              Authenticate with a private workspace credential to open the
              Private Workspace Dashboard.
            </p>

            {biometricSupported && accessStatus.hasAnyBiometricCredentials && (
              <button
                type="button"
                disabled={submitting || cooldownSeconds > 0}
                onClick={() => void handleVerifyEntryWebAuthn()}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-[#B0893E] bg-[#EFEAE0]/60 px-4 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] disabled:opacity-60 dark:bg-[#10233D] dark:text-[#D4AF6A] dark:hover:bg-[#172E4D]"
              >
                <Fingerprint className="h-4 w-4 text-[#B0893E]" aria-hidden="true" />
                <span>Verify with Platform Passkey</span>
              </button>
            )}

            <div>
              <label
                htmlFor="gate-auth-passphrase"
                className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Workspace Passphrase
              </label>
              <div className="relative flex items-center">
                <input
                  id="gate-auth-passphrase"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter private passphrase"
                  className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] pl-3 pr-11 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  aria-label={showPass ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-1 inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md text-[#5C6470] dark:text-[#9AA6B8]"
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

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="min-h-[44px] rounded-lg border border-[#D8D0C0] px-4 text-xs font-semibold text-[#0B192C] dark:border-[#294366] dark:text-[#FBF9F5]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || cooldownSeconds > 0}
                className="min-h-[44px] rounded-lg bg-[#0B192C] px-5 text-xs font-semibold text-[#FBF9F5] disabled:opacity-60 dark:bg-[#B0893E] dark:text-[#0B192C]"
              >
                {cooldownSeconds > 0
                  ? `Wait ${cooldownSeconds}s`
                  : submitting
                    ? 'Verifying...'
                    : 'Verify & Enter'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
