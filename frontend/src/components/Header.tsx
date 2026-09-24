import { useAuth } from "../context/AuthContext";
import { Button } from "./Button";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold">R</div>
        <span className="font-semibold text-lg">ReachInbox Scheduler</span>
      </div>

      {user && (
        <div className="flex items-center gap-3">
          <img src={user.avatarUrl} alt={user.name} className="w-9 h-9 rounded-full border border-gray-200" />
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>
          <Button variant="secondary" onClick={logout}>
            Logout
          </Button>
        </div>
      )}
    </header>
  );
}
