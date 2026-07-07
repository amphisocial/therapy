(function () {
  function qs(s, root = document) { return root.querySelector(s); }

  function maskInitialPassword() {
    const initial = qs('#adminAddUserForm [name="initialPassword"]');
    if (initial) {
      initial.type = 'password';
      initial.autocomplete = 'new-password';
    }
  }

  function securePasswordPrompt(title, description) {
    return new Promise(resolve => {
      const existing = qs('#securePasswordModal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.className = 'modal show secure-password-modal';
      modal.id = 'securePasswordModal';
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
      qs('#securePasswordTitle', modal).textContent = title || 'Reset password';
      qs('.secure-password-help', modal).textContent = description || 'Enter a temporary password. It will be masked and will not be displayed again.';

      const input = qs('#securePasswordInput', modal);
      const confirm = qs('#securePasswordConfirm', modal);
      const msg = qs('#securePasswordMessage', modal);

      function cleanup(value) {
        modal.remove();
        resolve(value);
      }

      qs('[data-secure-close]', modal).onclick = () => cleanup(null);
      qs('[data-secure-cancel]', modal).onclick = () => cleanup(null);
      modal.addEventListener('click', e => { if (e.target === modal) cleanup(null); });

      qs('#securePasswordForm', modal).onsubmit = e => {
        e.preventDefault();
        if (input.value.length < 10) {
          msg.textContent = 'Password must be at least 10 characters.';
          msg.className = 'message show error';
          return;
        }
        if (input.value !== confirm.value) {
          msg.textContent = 'Passwords do not match.';
          msg.className = 'message show error';
          return;
        }
        cleanup(input.value);
      };

      setTimeout(() => input.focus(), 0);
    });
  }

  function installSecureAdminHandlers() {
    maskInitialPassword();

    const form = qs('#adminAddUserForm');
    if (form && !form.__secureInviteHandler) {
      form.__secureInviteHandler = true;
      form.addEventListener('submit', async e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        try {
          const body = Object.fromEntries(new FormData(form).entries());
          const out = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
          const invite = qs('#inviteOutput');
          if (invite) {
            invite.hidden = false;
            invite.textContent = `User created for ${out.invite.email}. Share the initial password you entered through an approved secure channel. Temporary passwords are not displayed after creation. MFA setup key: ${out.invite.mfaSetupKey}`;
          }
          form.reset();
          maskInitialPassword();
          if (typeof loadAdmin === 'function') await loadAdmin();
        } catch (err) {
          alert(err.message || 'Could not create user.');
        }
      }, true);
    }

    try {
      resetAdminPassword = async function (id) {
        const pwd = await securePasswordPrompt(
          'Reset user password',
          'Enter a temporary password for this user. It will be masked and will not be shown in the success message.'
        );
        if (!pwd) return;
        try {
          const out = await api(`/api/admin/users/${id}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ initialPassword: pwd })
          });
          alert(`Password reset for ${out.user.email}. Temporary password was updated and is not displayed for security.`);
        } catch (e) {
          alert(e.message || 'Could not reset password.');
        }
      };
    } catch {}
  }

  function wrapLoadAdmin() {
    try {
      if (typeof loadAdmin === 'function' && !loadAdmin.__secureWrapped) {
        const originalLoadAdmin = loadAdmin;
        loadAdmin = async function () {
          const result = await originalLoadAdmin.apply(this, arguments);
          installSecureAdminHandlers();
          return result;
        };
        loadAdmin.__secureWrapped = true;
      }
    } catch {}
  }

  function wrapSetAuthenticatedUI() {
    try {
      if (typeof setAuthenticatedUI === 'function' && !setAuthenticatedUI.__secureWrapped) {
        const originalSetAuthenticatedUI = setAuthenticatedUI;
        setAuthenticatedUI = function () {
          const result = originalSetAuthenticatedUI.apply(this, arguments);
          // No MutationObserver. CSS handles hiding public sections using body.app-authenticated.
          return result;
        };
        setAuthenticatedUI.__secureWrapped = true;
      }
    } catch {}
  }

  wrapSetAuthenticatedUI();
  wrapLoadAdmin();
  installSecureAdminHandlers();
})();
