"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/api";
import { errorMessage } from "@/lib/domain";
import type { Profile } from "@/lib/types";
import { subscribeToRefresh } from "@/lib/live-sync";
type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  ready: boolean;
  error: string;
  refreshProfile: () => void;
};
const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  ready: false,
  error: "",
  refreshProfile: () => {},
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    try {
      const client = createClient();
      void client.auth
        .getSession()
        .then(({ data, error: sessionError }) => {
          if (active) {
            if (sessionError) setError(sessionError.message);
            setUser(data.session?.user ?? null);
            setSessionReady(true);
          }
        })
        .catch((e) => {
          if (active) {
            setError(errorMessage(e));
            setSessionReady(true);
          }
        });
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        if (active) {
          setUser(session?.user ?? null);
          setSessionReady(true);
        }
      });
      return () => {
        active = false;
        data.subscription.unsubscribe();
      };
    } catch (e) {
      void Promise.resolve().then(() => {
        if (active) { setError(errorMessage(e)); setSessionReady(true); }
      });
    }
    return () => {
      active = false;
    };
  }, []);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let pending = false;
    const load = () => {
      if (pending || !active) return;
      pending = true;
      void getProfile(userId)
      .then((p) => {
        if (active) {
          setProfile(p);
          setProfileFor(userId);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setProfile(null);
          setProfileFor(userId);
          setError(`Account setup could not be loaded: ${errorMessage(e)}`);
        }
      }).finally(() => { pending = false; });
    };
    load();
    // Role/status are authoritative database fields, not stale JWT metadata.
    const unsubscribe = subscribeToRefresh(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId, revision]);
  const ready = sessionReady && (!user || profileFor === user.id);
  return (
    <AuthContext.Provider
      value={{
        user,
        profile: user ? profile : null,
        ready,
        error,
        refreshProfile: () => setRevision((v) => v + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}
