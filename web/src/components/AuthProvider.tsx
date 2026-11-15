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
      setError(errorMessage(e));
      setSessionReady(true);
    }
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    void getProfile(user.id)
      .then((p) => {
        if (active) {
          setProfile(p);
          setProfileFor(user.id);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setProfile(null);
          setProfileFor(user.id);
          setError(`Account setup could not be loaded: ${errorMessage(e)}`);
        }
      });
    return () => {
      active = false;
    };
  }, [user?.id, revision]);
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
