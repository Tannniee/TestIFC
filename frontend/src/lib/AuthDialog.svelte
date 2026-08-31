<script lang="ts">
  import type { AuthStatus } from "./api";
  import type { CopyText } from "./i18n";

  export let text: CopyText;
  export let busy: boolean;
  export let error: string | null;
  export let status: AuthStatus | null;
  export let onLogin: () => void;
  export let onLogout: () => void;
</script>

<div class="dialog-backdrop auth-backdrop">
  <div class="qn-dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <header class="qn-dialog__header"><h2 id="auth-title">{text.authTitle}</h2></header>
    <div class="auth-dialog__body">
      <p>{text.authIntro}</p>
      {#if busy}<p>{text.authChecking}</p>{/if}
      {#if error}<p class="auth-error" role="alert">{error}</p>{/if}
      {#if status?.name}<p>{status.name}{status.email ? ` · ${status.email}` : ""}</p>{/if}
      <div class="auth-actions">
        {#if status?.authenticated}<button class="qn-action-button qn-action-button-secondary" disabled={busy} onclick={onLogout}>{text.authLogout}</button>{/if}
        <button class="qn-action-button" disabled={busy} onclick={onLogin}>{text.authLogin}</button>
      </div>
    </div>
  </div>
</div>
