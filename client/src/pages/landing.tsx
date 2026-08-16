import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient, setCsrfToken } from "@/lib/queryClient";

type AuthMode = "signin" | "signup";

export default function Landing() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/auth/${mode}`, { email, password });
      return res.json() as Promise<{ csrfToken: string }>;
    },
    onSuccess: async (data) => {
      setCsrfToken(data.csrfToken);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
    },
    onError: () => setMessage("Authentication failed. Access is restricted to approved operators."),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    mutation.mutate();
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <div className="flex items-center gap-3 text-primary">
            <ShieldCheck className="h-9 w-9" />
            <span className="text-2xl font-bold text-white">FinCoach</span>
          </div>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white md:text-6xl">
              Private research, risk, and portfolio operations.
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              Operator access is invite-only. Market research, portfolio state, and execution controls require an authenticated session.
            </p>
          </div>
        </div>

        <Card className="border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              {mode === "signin" ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
              {mode === "signin" ? "Sign in" : "Request operator account"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} />
              </div>
              {message && <p className="text-sm text-destructive">{message}</p>}
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mode === "signin" ? "Sign In" : "Sign Up"}
              </Button>
            </form>
            <Button type="button" variant="ghost" className="mt-4 w-full" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? "Create an approved account" : "Use an existing account"}
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
