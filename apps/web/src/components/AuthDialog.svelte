<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { api } from "../lib/api";
  import type { AuthUser } from "@hegemonia/shared";
  import Icon from "./Icon.svelte";

  let mode = $state<"login" | "register">("login");
  let identifier = $state("");
  let email = $state("");
  let username = $state("");
  let displayName = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;
    try {
      const result = mode === "login"
        ? await api<{ user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) })
        : await api<{ user: AuthUser }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, username, displayName, password }) });
      auth.user = result.user;
      auth.dialogOpen = false;
      password = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Falha ao autenticar.";
    } finally {
      loading = false;
    }
  }
</script>

{#if auth.dialogOpen}
  <div class="auth-backdrop" role="presentation">
    <dialog open class="auth-dialog" aria-labelledby="auth-title">
      <button class="dialog-close" aria-label="Fechar" onclick={() => auth.dialogOpen = false}>×</button>
      <div class="auth-mark"><Icon name="shield" size={28}/></div>
      <span class="eyebrow">COMANDO CENTRAL</span>
      <h2 id="auth-title">{mode === "login" ? "Acessar sua conta" : "Alistar novo comandante"}</h2>
      <p class="auth-intro">Carreira, conquistas e companheiros de campanha em um único registro.</p>
      <div class="auth-tabs" role="tablist">
        <button class:active={mode === "login"} onclick={() => { mode = "login"; error = ""; }}>Entrar</button>
        <button class:active={mode === "register"} onclick={() => { mode = "register"; error = ""; }}>Criar conta</button>
      </div>
      <form onsubmit={submit}>
        {#if mode === "register"}
          <label>E-mail<input type="email" bind:value={email} autocomplete="email" required maxlength="254" placeholder="comandante@exemplo.com"/></label>
          <div class="form-row">
            <label>Usuário<input bind:value={username} autocomplete="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" placeholder="general_01"/></label>
            <label>Nome de exibição<input bind:value={displayName} required maxlength="32" placeholder="General"/></label>
          </div>
        {:else}
          <label>E-mail ou usuário<input bind:value={identifier} autocomplete="username" required placeholder="general_01"/></label>
        {/if}
        <label>Senha<input type="password" bind:value={password} autocomplete={mode === "login" ? "current-password" : "new-password"} required minlength={mode === "register" ? 12 : 1} maxlength="128" placeholder={mode === "register" ? "Mínimo de 12 caracteres" : "Sua senha"}/></label>
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        <button class="gold-button full" disabled={loading}>{loading ? "Processando..." : mode === "login" ? "Entrar no comando" : "Criar minha conta"}</button>
      </form>
      <p class="security-note">Sua sessão fica em um cookie protegido. Convidados ainda podem jogar sem cadastro.</p>
    </dialog>
  </div>
{/if}
