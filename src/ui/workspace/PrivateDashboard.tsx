import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Edit3,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  PrivateAccessStatus,
  WorkspaceAuthMethod,
  WorkspaceSummary,
} from '../../core/common/types';
import {
  apiClient,
  ClientReauthProof,
  isPlatformBiometricAvailable,
  runBrowserWebAuthnAssertion,
  runBrowserWebAuthnRegistration,
  WebAuthnCredentialView,
} from '../../core/network/apiClient';

interface PrivateDashboardProps {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
  accessStatus: PrivateAccessStatus;
  onRefreshDashboardData: () => Promise<void>;
  onOpenCreateWorkspace: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onLockWorkspace: (workspaceId: string) => Promise<void>;
  onLockAllAndExit: () => Promise<void>;
  onExitDashboard: () => void;
  onUpdateAccessStatus: (status: PrivateAccessStatus) => void;
}

function formatDateLabel(iso?: string): string {
  if (!iso) return 'No recent activity';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed) || parsed < 86_400_000) return 'System baseline';
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function authMethodLabel(method: WorkspaceSummary['authMethod']): string {
  if (method === 'passphrase') return 'Passphrase';
  if (method === 'biometric') return 'Biometric Passkey';
  if (method === 'both') return 'Biometric + Passphrase';
  return 'Unprotected (Default)';
}

export function PrivateDashboard({
  workspaces,
  activeWorkspaceId,
  accessStatus,
  onRefreshDashboardData,
  onOpenCreateWorkspace,
  onOpenWorkspace,
  onLockWorkspace,
  onLockAllAndExit,
  onExitDashboard,
  onUpdateAccessStatus,
}: PrivateDashboardProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Security editor modal/panel state
  const [securityTarget, setSecurityTarget] = useState<WorkspaceSummary | null>(
    null,
  );
  const [authMethodDraft, setAuthMethodDraft] =
    useState<Exclude<WorkspaceAuthMethod, 'none'>>('passphrase');
  const [autoLockDraft, setAutoLockDraft] = useState(5);
  const [newPassDraft, setNewPassDraft] = useState('');
  const [confirmNewPassDraft, setConfirmNewPassDraft] = useState('');
  const [securityReauthPass, setSecurityReauthPass] = useState('');
  const [showSecurityPass, setShowSecurityPass] = useState(false);
  const [credentials, setCredentials] = useState<WebAuthnCredentialView[]>([]);
  const [biometricSupported, setBiometricSupported] = useState(false);

  // Explicit secure delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(
    null,
  );
  const [deleteReauthPass, setDeleteReauthPass] = useState('');

  // Method A & B gate settings state
  const [searchPhraseInput, setSearchPhraseInput] = useState('');
  const [searchPhraseConfirm, setSearchPhraseConfirm] = useState('');
  const [showSearchPhrase, setShowSearchPhrase] = useState(false);
  const [doubleTapMs, setDoubleTapMs] = useState(
    accessStatus.doubleTapIntervalMs,
  );

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDoubleTapMs(accessStatus.doubleTapIntervalMs);
  }, [accessStatus.doubleTapIntervalMs]);

  useEffect(() => {
    void isPlatformBiometricAvailable().then(setBiometricSupported);
  }, []);

  useEffect(() => {
    if (!securityTarget) {
      setCredentials([]);
      return;
    }
    setAuthMethodDraft(
      securityTarget.authMethod === 'none'
        ? 'passphrase'
        : securityTarget.authMethod,
    );
    setAutoLockDraft(securityTarget.autoLockMinutes);
    setNewPassDraft('');
    setConfirmNewPassDraft('');
    setSecurityReauthPass('');
    setModalError(null);
    void apiClient
      .listWebAuthnCredentials(securityTarget.id)
      .then((res) => setCredentials(res.credentials))
      .catch(() => setCredentials([]));
  }, [securityTarget]);

  const clearFeedback = () => {
    setErrorMsg(null);
    setModalError(null);
    setStatusMessage(null);
  };

  const handleRenameSubmit = async (wsId: string) => {
    clearFeedback();
    setBusy(true);
    try {
      await apiClient.renameWorkspace(wsId, renameValue);
      await onRefreshDashboardData();
      setRenamingId(null);
      setStatusMessage('Workspace renamed.');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to rename workspace.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnrollPasskey = async () => {
    if (!securityTarget) return;
    clearFeedback();
    if (securityTarget.isLocked) {
      setModalError('Open this workspace first before enrolling a passkey.');
      return;
    }
    setBusy(true);
    try {
      const opts = await apiClient.getWebAuthnRegisterOptions(securityTarget.id);
      const registration = await runBrowserWebAuthnRegistration(opts);
      await apiClient.verifyWebAuthnRegistration(securityTarget.id, {
        challengeId: opts.challengeId,
        label: 'Platform Biometric Passkey',
        registration,
      });
      const listRes = await apiClient.listWebAuthnCredentials(securityTarget.id);
      setCredentials(listRes.credentials);
      await onRefreshDashboardData();
      setStatusMessage('Platform biometric passkey enrolled and verified.');
    } catch (err) {
      setModalError((err as Error).message || 'Unable to enroll passkey.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePasskey = async (credId: string) => {
    if (!securityTarget) return;
    clearFeedback();
    if (!securityReauthPass) {
      setModalError(
        'Enter your current workspace passphrase below to remove a passkey.',
      );
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.removeWebAuthnCredential(
        securityTarget.id,
        credId,
        { passphrase: securityReauthPass },
      );
      setCredentials(res.credentials);
      setSecurityReauthPass('');
      await onRefreshDashboardData();
      setStatusMessage('Biometric passkey removed.');
    } catch (err) {
      setSecurityReauthPass('');
      setModalError((err as Error).message || 'Unable to remove passkey.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!securityTarget) return;
    clearFeedback();

    const changingAuth =
      authMethodDraft !== securityTarget.authMethod ||
      newPassDraft.length > 0;

    if (newPassDraft) {
      const norm = newPassDraft.normalize('NFC');
      if (Array.from(norm).length < 8) {
        setModalError('New passphrase must be at least 8 characters long.');
        return;
      }
      if (norm !== confirmNewPassDraft.normalize('NFC')) {
        setModalError('New passphrases do not match.');
        return;
      }
    }

    if (changingAuth && !securityReauthPass) {
      setModalError(
        'Fresh current passphrase verification is required to modify authentication settings.',
      );
      return;
    }

    setBusy(true);
    try {
      await apiClient.updateWorkspaceSettings(
        securityTarget.id,
        {
          autoLockMinutes: autoLockDraft,
          authMethod:
            authMethodDraft !== securityTarget.authMethod
              ? authMethodDraft
              : undefined,
          newPassphrase: newPassDraft ? newPassDraft.normalize('NFC') : undefined,
        },
        changingAuth ? { passphrase: securityReauthPass } : undefined,
      );
      setNewPassDraft('');
      setConfirmNewPassDraft('');
      setSecurityReauthPass('');
      setModalError(null);
      await onRefreshDashboardData();
      setSecurityTarget(null);
      setStatusMessage('Workspace security settings updated.');
    } catch (err) {
      setSecurityReauthPass('');
      setModalError(
        (err as Error).message || 'Failed to update security settings.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async (
    e: React.FormEvent,
    useWebAuthn: boolean = false,
  ) => {
    e.preventDefault();
    if (!deleteTarget) return;
    clearFeedback();

    setBusy(true);
    try {
      let reauth: ClientReauthProof;
      if (useWebAuthn) {
        const opts = await apiClient.getWebAuthnAuthOptions(
          'reauth',
          deleteTarget.id,
        );
        const assertion = await runBrowserWebAuthnAssertion(opts);
        reauth = { webauthn: { challengeId: opts.challengeId, assertion } };
      } else {
        if (!deleteReauthPass) {
          setModalError('Enter workspace passphrase to confirm deletion.');
          setBusy(false);
          return;
        }
        reauth = { passphrase: deleteReauthPass };
      }

      await apiClient.deleteWorkspace(deleteTarget.id, reauth);
      setDeleteReauthPass('');
      setModalError(null);
      setDeleteTarget(null);
      await onRefreshDashboardData();
      setStatusMessage('Private workspace and encrypted records permanently removed.');
    } catch (err) {
      setDeleteReauthPass('');
      setModalError((err as Error).message || 'Unable to delete workspace.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEntryPhrase = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    const norm = searchPhraseInput.normalize('NFC');
    if (Array.from(norm).length < 8) {
      setErrorMsg('Search access phrase must be at least 8 characters long.');
      return;
    }
    if (norm.length > 1024) {
      setErrorMsg('Search access phrase must not exceed 1024 characters.');
      return;
    }
    if (norm !== searchPhraseConfirm.normalize('NFC')) {
      setErrorMsg('Search access phrases do not match.');
      return;
    }
    setBusy(true);
    try {
      const updated = await apiClient.updatePrivateAccessConfig({
        searchPassphrase: norm,
      });
      onUpdateAccessStatus(updated);
      setSearchPhraseInput('');
      setSearchPhraseConfirm('');
      setShowSearchPhrase(false);
      setStatusMessage('Search entry passphrase saved securely with Argon2id.');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to save access phrase.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearEntryPhrase = async () => {
    clearFeedback();
    setBusy(true);
    try {
      const updated = await apiClient.updatePrivateAccessConfig({
        searchPassphrase: null,
      });
      onUpdateAccessStatus(updated);
      setStatusMessage('Search entry passphrase removed.');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to remove access phrase.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDoubleTapInterval = async (intervalMs: number) => {
    clearFeedback();
    setDoubleTapMs(intervalMs);
    try {
      const updated = await apiClient.updatePrivateAccessConfig({
        doubleTapIntervalMs: intervalMs,
      });
      onUpdateAccessStatus(updated);
      setStatusMessage(`Double-tap detection window set to ${intervalMs}ms.`);
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to save timing setting.');
    }
  };

  return (
    <section
      aria-label="Private Workspace Dashboard"
      className="space-y-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E3DDD1] pb-5 dark:border-[#1E324D]">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8E6A28] dark:text-[#D4AF6A]">
            Protected Vault Management
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5]">
            Private Workspace Dashboard
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onExitDashboard}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#D8D0C0] px-3.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Reader</span>
          </button>

          <button
            type="button"
            onClick={() => void onLockAllAndExit()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#D8D0C0] px-3.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
          >
            <Lock className="h-3.5 w-3.5 text-[#B0893E]" aria-hidden="true" />
            <span>Lock All &amp; Exit</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreateWorkspace}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0B192C] px-4 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] dark:bg-[#B0893E] dark:text-[#0B192C]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Private Workspace</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50/90 px-4 py-3 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          {statusMessage}
        </p>
      )}

      {errorMsg && (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs font-medium text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
        >
          {errorMsg}
        </p>
      )}

      {/* Workspace Selector & Controls */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
            Workspaces
          </h2>
          <span className="text-xs text-[#5C6470] dark:text-[#9AA6B8] tabular-nums">
            {workspaces.length} total
          </span>
        </div>

        <div className="divide-y divide-[#E3DDD1] rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] dark:divide-[#1E324D] dark:border-[#1E324D] dark:bg-[#10233D]">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            return (
              <div
                key={ws.id}
                className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  {renamingId === ws.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        maxLength={60}
                        aria-label="New workspace name"
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="min-h-[38px] w-full max-w-[240px] rounded-lg border border-[#B0893E] bg-[#FBF9F5] px-3 text-xs text-[#0B192C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRenameSubmit(ws.id)}
                        aria-label="Confirm workspace rename"
                        className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg bg-[#0B192C] px-3 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="min-h-[38px] px-2 text-xs text-[#5C6470] dark:text-[#9AA6B8]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="font-serif text-lg font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
                        {ws.displayName}
                      </h3>
                      {isActive && (
                        <span className="text-xs font-semibold text-[#8E6A28] dark:text-[#D4AF6A]">
                          · Active Session
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#5C6470] dark:text-[#9AA6B8]">
                    <span className="font-medium text-[#0B192C] dark:text-[#E5E9F0]">
                      {ws.isPrivate
                        ? ws.isLocked
                          ? 'Locked (Encrypted)'
                          : 'Unlocked (RAM Session)'
                        : 'Public Editorial'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{authMethodLabel(ws.authMethod)}</span>
                    {ws.isPrivate && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          Auto-lock{' '}
                          {ws.autoLockMinutes === 0
                            ? 'Manual'
                            : `${ws.autoLockMinutes}m`}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      Created {formatDateLabel(ws.createdAt)}
                    </span>
                    {ws.lastActivityAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          Last active {formatDateLabel(ws.lastActivityAt)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
                  <button
                    type="button"
                    onClick={() => onOpenWorkspace(ws.id)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#0B192C] px-3.5 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] dark:bg-[#B0893E] dark:text-[#0B192C]"
                  >
                    {ws.isLocked ? (
                      <>
                        <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Unlock &amp; Open</span>
                      </>
                    ) : (
                      <span>{isActive ? 'Open Reader' : 'Switch Into'}</span>
                    )}
                  </button>

                  {ws.isPrivate && !ws.isLocked && (
                    <button
                      type="button"
                      onClick={async () => {
                        clearFeedback();
                        await onLockWorkspace(ws.id);
                      }}
                      className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#D8D0C0] px-2.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
                    >
                      <Lock className="h-3.5 w-3.5 text-[#B0893E]" aria-hidden="true" />
                      <span>Lock</span>
                    </button>
                  )}

                  {ws.isPrivate && (
                    <>
                      <button
                        type="button"
                        aria-label={`Rename ${ws.displayName}`}
                        onClick={() => {
                          setRenamingId(ws.id);
                          setRenameValue(ws.displayName);
                        }}
                        className="inline-flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-lg border border-[#D8D0C0] px-2.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Rename</span>
                      </button>

                      <button
                        type="button"
                        aria-label={`Security settings for ${ws.displayName}`}
                        onClick={() => setSecurityTarget(ws)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#D8D0C0] px-2.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
                      >
                        <KeyRound className="h-3.5 w-3.5 text-[#B0893E]" aria-hidden="true" />
                        <span>Security</span>
                      </button>

                      <button
                        type="button"
                        aria-label={`Delete ${ws.displayName}`}
                        onClick={() => {
                          setDeleteReauthPass('');
                          setModalError(null);
                          setDeleteTarget(ws);
                        }}
                        className="inline-flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-lg border border-red-300 px-2.5 text-xs font-semibold text-red-800 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Private Access Entry Settings (Method A & Method B) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-6 dark:border-[#1E324D] dark:bg-[#10233D]">
          <div className="flex items-center justify-between border-b border-[#ECE7DC] pb-3 dark:border-[#1E324D]">
            <h2 className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
              Method A · Search Access Phrase
            </h2>
            <span className="text-xs font-semibold text-[#8E6A28] dark:text-[#D4AF6A]">
              {accessStatus.hasSearchPassphrase ? 'Configured' : 'Not set'}
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#5C6470] dark:text-[#9AA6B8]">
            Submitting this phrase in Newsie&apos;s Search bar intercepts it before
            search indexing or history, clears the input, and opens Private Access
            Verification. Stored salted with Argon2id.
          </p>

          <form onSubmit={handleSaveEntryPhrase} className="mt-4 space-y-3">
            <div className="relative flex items-center">
              <label htmlFor="entry-phrase-input" className="sr-only">
                Search access phrase
              </label>
              <input
                id="entry-phrase-input"
                type={showSearchPhrase ? 'text' : 'password'}
                minLength={8}
                maxLength={1024}
                autoComplete="new-password"
                value={searchPhraseInput}
                onChange={(e) => setSearchPhraseInput(e.target.value)}
                placeholder="New access phrase (min 8 chars, Unicode/emoji supported)"
                className="min-h-[42px] w-full rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] pl-3 pr-10 text-xs text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
              />
              <button
                type="button"
                onClick={() => setShowSearchPhrase((s) => !s)}
                aria-label={
                  showSearchPhrase ? 'Hide access phrase' : 'Show access phrase'
                }
                className="absolute right-1 inline-flex min-h-[36px] min-w-[36px] items-center justify-center text-[#5C6470] dark:text-[#9AA6B8]"
              >
                {showSearchPhrase ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            <label htmlFor="entry-phrase-confirm" className="sr-only">
              Confirm search access phrase
            </label>
            <input
              id="entry-phrase-confirm"
              type={showSearchPhrase ? 'text' : 'password'}
              minLength={8}
              maxLength={1024}
              autoComplete="new-password"
              value={searchPhraseConfirm}
              onChange={(e) => setSearchPhraseConfirm(e.target.value)}
              placeholder="Confirm search access phrase"
              className="min-h-[42px] w-full rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {accessStatus.hasSearchPassphrase ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleClearEntryPhrase()}
                  className="min-h-[38px] rounded-lg border border-[#D8D0C0] px-3 text-xs font-semibold text-[#5C6470] hover:text-[#0B192C] dark:border-[#294366] dark:text-[#9AA6B8]"
                >
                  Clear Phrase
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={busy}
                className="min-h-[40px] rounded-lg bg-[#0B192C] px-4 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
              >
                Save Access Phrase
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-6 dark:border-[#1E324D] dark:bg-[#10233D]">
          <div className="flex items-center justify-between border-b border-[#ECE7DC] pb-3 dark:border-[#1E324D]">
            <h2 className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
              Method B · Search Double-Tap Gesture
            </h2>
            <span className="font-mono text-xs font-semibold text-[#8E6A28] dark:text-[#D4AF6A] tabular-nums">
              {doubleTapMs}ms
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#5C6470] dark:text-[#9AA6B8]">
            Double-tap or double-click the Search navigation button within the
            configured interval to request Private Access Verification. Normal
            single-tap Search behavior stays intact.
          </p>

          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="double-tap-interval"
                className="text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
              >
                Double-Tap Window
              </label>
              <select
                id="double-tap-interval"
                value={doubleTapMs}
                onChange={(e) =>
                  void handleSaveDoubleTapInterval(Number(e.target.value))
                }
                className="min-h-[40px] rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
              >
                <option value={250}>Fast (250 ms)</option>
                <option value={350}>Default (350 ms)</option>
                <option value={500}>Relaxed (500 ms)</option>
                <option value={650}>Extended (650 ms)</option>
              </select>
            </div>

            <div className="border-t border-[#ECE7DC] pt-3 text-xs text-[#5C6470] dark:border-[#1E324D] dark:text-[#9AA6B8]">
              <strong className="font-semibold text-[#0B192C] dark:text-[#E5E9F0]">
                Keyboard alternatives:
              </strong>{' '}
              Press <kbd className="font-mono">Shift + Enter</kbd> while focused on
              Search navigation, or <kbd className="font-mono">Alt + Shift + P</kbd>{' '}
              anywhere in the reader.
            </div>
          </div>
        </div>
      </div>

      {/* Workspace Security & Authentication Settings Modal */}
      {securityTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ws-security-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/75 p-4 backdrop-blur-sm"
          onClick={() => setSecurityTarget(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E3DDD1] bg-[#FBF9F5] p-6 shadow-2xl dark:border-[#1E324D] dark:bg-[#0B192C]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-[#E3DDD1] pb-3 dark:border-[#1E324D]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#B0893E]" aria-hidden="true" />
                <h3
                  id="ws-security-title"
                  className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]"
                >
                  Security · {securityTarget.displayName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSecurityTarget(null)}
                className="text-xs font-semibold text-[#5C6470] dark:text-[#9AA6B8]"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveSecuritySettings} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sec-autolock"
                    className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                  >
                    Inactivity Auto-Lock
                  </label>
                  <select
                    id="sec-autolock"
                    value={autoLockDraft}
                    onChange={(e) => setAutoLockDraft(Number(e.target.value))}
                    className="min-h-[42px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                  >
                    <option value={1}>1 minute</option>
                    <option value={5}>5 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={0}>Manual only</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="sec-auth-method"
                    className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                  >
                    Authentication Policy
                  </label>
                  <select
                    id="sec-auth-method"
                    value={authMethodDraft}
                    onChange={(e) =>
                      setAuthMethodDraft(
                        e.target.value as Exclude<WorkspaceAuthMethod, 'none'>,
                      )
                    }
                    className="min-h-[42px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                  >
                    <option value="passphrase">Passphrase only</option>
                    {credentials.length > 0 && (
                      <option value="biometric">Biometric Passkey (WebAuthn)</option>
                    )}
                    {credentials.length > 0 && (
                      <option value="both">Biometric + Passphrase (MFA)</option>
                    )}
                  </select>
                </div>
              </div>

              {/* WebAuthn Platform Passkeys */}
              <div className="space-y-3 rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-4 dark:border-[#1E324D] dark:bg-[#10233D]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Fingerprint
                      className="h-4 w-4 text-[#B0893E]"
                      aria-hidden="true"
                    />
                    <span className="text-xs font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
                      WebAuthn Platform Passkeys
                    </span>
                  </div>
                  {biometricSupported && !securityTarget.isLocked && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleEnrollPasskey()}
                      className="min-h-[34px] rounded-md bg-[#0B192C] px-3 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
                    >
                      Enroll Passkey
                    </button>
                  )}
                </div>

                {!biometricSupported ? (
                  <p className="text-[11px] text-[#5C6470] dark:text-[#9AA6B8]">
                    Platform biometric WebAuthn authenticator is unavailable on this
                    browser/device. Passphrase protection remains active.
                  </p>
                ) : securityTarget.isLocked ? (
                  <p className="text-[11px] text-[#5C6470] dark:text-[#9AA6B8]">
                    Unlock this workspace first to enroll or bind a new passkey.
                  </p>
                ) : (
                  <p className="text-[11px] text-[#5C6470] dark:text-[#9AA6B8]">
                    Uses standard browser WebAuthn platform credentials verified on
                    this local server (not Android Keystore hardware encryption).
                  </p>
                )}

                {credentials.length > 0 && (
                  <ul className="divide-y divide-[#ECE7DC] dark:divide-[#1E324D]">
                    {credentials.map((cred) => (
                      <li
                        key={cred.credentialId}
                        className="flex items-center justify-between py-2 text-xs"
                      >
                        <div>
                          <p className="font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                            {cred.label}
                          </p>
                          <p className="text-[11px] text-[#5C6470] dark:text-[#9AA6B8] tabular-nums">
                            Enrolled {formatDateLabel(cred.createdAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRemovePasskey(cred.credentialId)}
                          className="text-xs font-semibold text-red-700 hover:underline dark:text-red-300"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3 border-t border-[#E3DDD1] pt-3 dark:border-[#1E324D]">
                <p className="text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]">
                  Rotate Workspace Passphrase (optional)
                </p>
                <div className="relative flex items-center">
                  <input
                    type={showSecurityPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    maxLength={1024}
                    value={newPassDraft}
                    onChange={(e) => setNewPassDraft(e.target.value)}
                    placeholder="New passphrase (min 8 chars)"
                    className="min-h-[40px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] pl-3 pr-10 text-xs text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecurityPass((s) => !s)}
                    aria-label={
                      showSecurityPass ? 'Hide passphrases' : 'Show passphrases'
                    }
                    className="absolute right-1 inline-flex min-h-[34px] min-w-[34px] items-center justify-center text-[#5C6470]"
                  >
                    {showSecurityPass ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {newPassDraft && (
                  <input
                    type={showSecurityPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    maxLength={1024}
                    value={confirmNewPassDraft}
                    onChange={(e) => setConfirmNewPassDraft(e.target.value)}
                    placeholder="Confirm new passphrase"
                    className="min-h-[40px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-xs text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                  />
                )}
              </div>

              <div>
                <label
                  htmlFor="sec-reauth-pass"
                  className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                >
                  Current Passphrase Verification (required for auth/passkey changes)
                </label>
                <input
                  id="sec-reauth-pass"
                  type="password"
                  autoComplete="current-password"
                  value={securityReauthPass}
                  onChange={(e) => setSecurityReauthPass(e.target.value)}
                  placeholder="Enter current workspace passphrase"
                  className="min-h-[42px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-xs text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
              </div>

              {modalError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
                >
                  {modalError}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSecurityTarget(null)}
                  className="min-h-[42px] rounded-lg border border-[#D8D0C0] px-4 text-xs font-semibold text-[#0B192C] dark:border-[#294366] dark:text-[#FBF9F5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] rounded-lg bg-[#0B192C] px-5 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
                >
                  {busy ? 'Saving...' : 'Save Security Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Explicit Confirmation + Mandatory Re-Auth Deletion Modal */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ws-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/75 p-4 backdrop-blur-sm"
          onClick={() => {
            setDeleteReauthPass('');
            setDeleteTarget(null);
          }}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl border border-red-300 bg-[#FBF9F5] p-6 shadow-2xl dark:border-red-900 dark:bg-[#0B192C]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2.5 text-red-800 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <h3
                  id="ws-delete-title"
                  className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]"
                >
                  Delete &ldquo;{deleteTarget.displayName}&rdquo;?
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[#5C6470] dark:text-[#9AA6B8]">
                  This permanently erases all encrypted articles, sources,
                  bookmarks, and history inside this workspace. Re-authentication
                  is required to confirm deletion.
                </p>
              </div>
            </div>

            <form
              onSubmit={(e) => void handleConfirmDelete(e, false)}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="delete-reauth-pass"
                  className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                >
                  Confirm with Workspace Passphrase
                </label>
                <input
                  id="delete-reauth-pass"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={deleteReauthPass}
                  onChange={(e) => setDeleteReauthPass(e.target.value)}
                  placeholder="Enter workspace passphrase"
                  className="min-h-[42px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
              </div>

              {biometricSupported && deleteTarget.hasBiometricCredential && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => void handleConfirmDelete(e, true)}
                  className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-[#B0893E] text-xs font-semibold text-[#0B192C] dark:text-[#D4AF6A]"
                >
                  <Fingerprint className="h-4 w-4 text-[#B0893E]" aria-hidden="true" />
                  <span>Confirm Deletion with Passkey</span>
                </button>
              )}

              {modalError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
                >
                  {modalError}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteReauthPass('');
                    setDeleteTarget(null);
                  }}
                  className="min-h-[42px] rounded-lg border border-[#D8D0C0] px-4 text-xs font-semibold text-[#0B192C] dark:border-[#294366] dark:text-[#FBF9F5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] rounded-lg bg-red-700 px-5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {busy ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
