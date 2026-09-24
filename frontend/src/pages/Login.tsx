import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";

export function Login() {
  const { loginWithGoogle, loginAsDemo } = useAuth();
  const navigate = useNavigate();

  async function handleSuccess(cred: CredentialResponse) {
    if (!cred.credential) return;
    try {
      await loginWithGoogle(cred.credential);
      navigate("/dashboard");
    } catch {
      toast.error("Google sign-in failed. Please try again.");
    }
  }

  async function handleDemoLogin() {
    try {
      await loginAsDemo();
      navigate("/dashboard");
    } catch {
      toast.error("Demo login failed.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-white">
      <div className="bg-white shadow-xl rounded-2xl p-10 w-full max-w-sm text-center">
        <div className="w-12 h-12 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-xl mx-auto mb-4">
          R
        </div>
        <h1 className="text-xl font-semibold mb-1">ReachInbox Scheduler</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to manage your cold email campaigns</p>
        <div className="flex flex-col items-center gap-3">
          <div className="flex justify-center w-full">
            <GoogleLogin onSuccess={handleSuccess} onError={() => toast.error("Google sign-in failed")} />
          </div>
          <div className="relative w-full my-1">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
            <div className="relative flex justify-center text-xs text-gray-400 bg-white px-2">or</div>
          </div>
          <button
            type="button"
            onClick={handleDemoLogin}
            className="w-full py-2.5 px-4 bg-gray-900 text-white hover:bg-gray-800 font-medium rounded-lg shadow-sm transition-colors text-sm"
          >
            One-Click Demo Sign-In
          </button>
        </div>
      </div>
    </div>
  );
}
