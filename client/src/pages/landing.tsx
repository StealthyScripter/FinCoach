import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient, setCsrfToken } from "@/lib/queryClient";

export default function Landing() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/signin", { email, password });
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
    <main className="min-h-screen bg-[#08111f] text-foreground">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-6 py-10 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <div className="flex items-center gap-3 text-emerald-300">
            <ShieldCheck className="h-9 w-9" aria-hidden="true" />
            <span className="text-2xl font-bold text-white">FinCoach</span>
          </div>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl">
              Private financial research and portfolio operations.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-300">
              FinCoach gives approved customers one authenticated workspace for market research, portfolio state, strategy review, risk controls, and execution readiness.
            </p>
          </div>
          <div className="grid max-w-2xl gap-3 text-sm text-slate-200 sm:grid-cols-3">
            {[
              { icon: BarChart3, label: "Research pipeline" },
              { icon: CheckCircle2, label: "Portfolio oversight" },
              { icon: LockKeyhole, label: "Protected controls" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2">
                <item.icon className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <p className="max-w-2xl text-sm text-slate-400">
            Access is currently limited to operator-provisioned customers.
          </p>
        </div>

        <Card className="border-white/10 bg-white/[0.06] shadow-2xl shadow-black/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <LogIn className="h-5 w-5" aria-hidden="true" />
              Login
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
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} />
              </div>
              {message && <p className="text-sm text-destructive">{message}</p>}
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                Login
              </Button>
            </form>
            {/* Public registration is intentionally disabled for the invitation-only launch.
                Future re-enablement requires PUBLIC_REGISTRATION_ENABLED=true and a reviewed signup route/UI. */}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
