(function () {
  function qs(s, root = document) { return root.querySelector(s); }
  function qsa(s, root = document) { return Array.from(root.querySelectorAll(s)); }

  function hasCurrentUser() {
    try { return typeof currentUser !== "undefined" && !!currentUser; } catch { return false; }
  }

  function getCurrentUser() {
    try { return typeof currentUser !== "undefined" ? currentUser : null; } catch { return null; }
  }

  function enforceWorkspaceOnly() {
    const user = getCurrentUser();
    const authed = !!user;
    document.body.classList.toggle("app-authenticated", authed);
    document.body.classList.toggle("app-anonymous", !authed);
    document.body.classList.toggle("app-has-token", !!localStorage.getItem("ta_token") && !authed);

    const publicNav = qs("#publicNav");
    const userNav = qs("#userNav");
    const workspace = qs("#workspace");
    const welcome = qs("#welcomeUser");

    if (publicNav) publicNav.hidden = authed;
    if (userNav) userNav.hidden = !authed;
    if (welcome && authed) welcome.textContent = `Welcome ${user.full_name || user.name || user.email || "User"}`;

    qsa(".public-section").forEach(el => {
      el.hidden = authed;
      el.setAttribute("aria-hidden", authed ? "true" : "false");
      if (authed) {
        el.style.display = "none";
        el.style.visibility = "hidden";
      } else {
        el.style.removeProperty("display");
        el.style.removeProperty("visibility");
      }
    });

    if (workspace) {
      workspace.hidden = !authed;
      workspace.setAttribute("aria-hidden", authed ? "false" : "true");
      if (authed) {
        workspace.style.display = "grid";
        workspace.style.visibility = "visible";
      } else {
        workspace.style.display = "none";
      }
    }
  }

  function installAuthOverride() {
    try {
      const original = typeof setAuthenticatedUI === "function" ? setAuthenticatedUI : null;
      if (original && !original.__therapyAgentFixed) {
        const wrapped = function () {
          original.apply(this, arguments);
          enforceWorkspaceOnly();
        };
        wrapped.__therapyAgentFixed = true;
        setAuthenticatedUI = wrapped;
      }
    } catch {}
    enforceWorkspaceOnly();
  }

  function securePasswordPrompt(title, description) {
    return new Promise(resolve => {
      const existing = qs("#securePasswordModal");
      if (existing) existing.remove();
      const modal = document.createElement("div");
      modal.className = "modal show secure-password-modal";
      modal.id = "securePasswordModal";
      modal.innerHTML = `
        <div class="modal-card secure-password-card" role="dialog" aria-modal="true" aria-labelledby="securePasswordTitle">
          <button class="x" type="button" data-secure-close aria-label="Close password dialog">×</button>
          <h3 id="securePasswordTitle"></h3>
          <p class="secure-password-help"></p>
          <form id="securePasswordForm" class="auth-form">
            <label>Temporary password
              <input id="securePasswordInput" type="password" required minlength="10" autocomplete="new-password">
            </label>
            <label>Confirm temporary password
              <input id="securePasswordConfirm" type="password" required minlength="10" autocomplete="new-password">
            </label>
            <div id="securePasswordMessage" class="message"></div>
            <div class="form-actions">
              <button class="btn" type="submit">Update password</button>
              <button class="btn secondary" type="button" data-secure-cancel>Cancel</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(modal);
      qs("#securePasswordTitle", modal).textContent = title || "Reset password";
      qs(".secure-password-help", modal).textContent = description || "Enter a temporary password. It will be masked and will not be displayed again.";
      const input = qs("#securePasswordInput", modal);
      const confirm = qs("#securePasswordConfirm", modal);
      const msg = qs("#securePasswordMessage", modal);
      function cleanup(value) { modal.remove(); resolve(value); }
      qs("[data-secure-close]", modal).onclick = () => cleanup(null);
      qs("[data-secure-cancel]", modal).onclick = () => cleanup(null);
      modal.addEventListener("click", e => { if (e.target === modal) cleanup(null); });
      qs("#securePasswordForm", modal).onsubmit = e => {
        e.preventDefault();
        if (input.value.length < 10) {
          msg.textContent = "Password must be at least 10 characters.";
          msg.className = "message show error";
          return;
        }
        if (input.value !== confirm.value) {
          msg.textContent = "Passwords do not match.";
          msg.className = "message show error";
          return;
        }
        cleanup(input.value);
      };
      setTimeout(() => input.focus(), 0);
    });
  }

  function installSecureAdminHandlers() {
    const initial = qs('#adminAddUserForm [name="initialPassword"]');
    if (initial) {
      initial.type = "password";
      initial.autocomplete = "new-password";
    }

    const form = qs("#adminAddUserForm");
    if (form && !form.__secureInviteHandler) {
      form.__secureInviteHandler = true;
      form.addEventListener("submit", async e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        try {
          const body = Object.fromEntries(new FormData(form).entries());
          const out = await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
          const invite = qs("#inviteOutput");
          if (invite) {
            invite.hidden = false;
            invite.textContent = `User created for ${out.invite.email}. Share the initial password you entered through an approved secure channel. Temporary passwords are not displayed after creation. MFA setup key: ${out.invite.mfaSetupKey}`;
          }
          form.reset();
          const resetInput = qs('#adminAddUserForm [name="initialPassword"]');
          if (resetInput) resetInput.type = "password";
          if (typeof loadAdmin === "function") await loadAdmin();
        } catch (err) {
          alert(err.message || "Could not create user.");
        }
      }, true);
    }

    try {
      resetAdminPassword = async function (id) {
        const pwd = await securePasswordPrompt(
          "Reset user password",
          "Enter a temporary password for this user. It will be masked and will not be shown in the success message."
        );
        if (!pwd) return;
        try {
          const out = await api(`/api/admin/users/${id}/reset-password`, {
            method: "POST",
            body: JSON.stringify({ initialPassword: pwd })
          });
          alert(`Password reset for ${out.user.email}. Temporary password was updated and is not displayed for security.`);
        } catch (e) {
          alert(e.message || "Could not reset password.");
        }
      };
    } catch {}
  }

  function installMutationGuard() {
    const observer = new MutationObserver(() => {
      const user = getCurrentUser();
      if (user) enforceWorkspaceOnly();
      installSecureAdminHandlers();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"] });
  }

  if (localStorage.getItem("ta_token")) document.body.classList.add("app-has-token");
  installAuthOverride();
  installSecureAdminHandlers();
  installMutationGuard();
  window.addEventListener("storage", enforceWorkspaceOnly);
  window.addEventListener("hashchange", enforceWorkspaceOnly);
  document.addEventListener("visibilitychange", enforceWorkspaceOnly);
})();
