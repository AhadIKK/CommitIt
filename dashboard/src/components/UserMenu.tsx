import { useState } from "react";
import { LogOut } from "lucide-react";
import { useMe } from "../lib/queries.js";
import { api } from "../api/index.js";

export function UserMenu() {
  const me = useMe();
  const [showConfirm, setShowConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const user = me.data;
  if (!user || !user.signedIn || !user.login) {
    return (
      <div className="user-menu">
        <a
          href="/api/auth/login"
          className="user-menu__signin"
          title="Sign in with GitHub"
        >
          Sign in
        </a>
      </div>
    );
  }

  const avatar = user.avatarUrl || `https://github.com/${user.login}.png`;

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await api.logout();
    } catch {
      // Best-effort logout; redirect home regardless
    } finally {
      window.location.href = "/";
    }
  };

  return (
    <div className="user-menu">
      <div className="user-menu__profile" title={`Signed in as @${user.login}`}>
        <img
          src={avatar}
          alt={`@${user.login}`}
          className="user-menu__avatar"
          onError={(e) => {
            (e.target as HTMLElement).style.display = "none";
          }}
        />
        <span className="user-menu__login num">@{user.login}</span>
      </div>

      <button
        type="button"
        className="user-menu__logout-btn"
        onClick={() => setShowConfirm(true)}
        aria-label="Log out"
        title="Log out"
      >
        <LogOut size={13} aria-hidden="true" />
        <span className="user-menu__logout-text">Log out</span>
      </button>

      {showConfirm ? (
        <div
          className="user-modal__backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !loggingOut) {
              setShowConfirm(false);
            }
          }}
        >
          <div className="user-modal__card">
            <h2 id="logout-dialog-title" className="user-modal__title">
              Confirm log out
            </h2>
            <p className="user-modal__body">
              Are you sure you want to log out of <strong>CommitIt</strong> (@{user.login})?
            </p>
            <div className="user-modal__actions">
              <button
                type="button"
                className="user-modal__btn user-modal__btn--cancel"
                onClick={() => setShowConfirm(false)}
                disabled={loggingOut}
              >
                Cancel
              </button>
              <button
                type="button"
                className="user-modal__btn user-modal__btn--confirm"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
