"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EmailLoginForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    try {
      await signIn("email", { email, callbackUrl: "/" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full">
      <label htmlFor="email-input" className="sr-only">
        邮箱
      </label>
      <Input
        id="email-input"
        type="email"
        placeholder="输入邮箱地址（QQ、163 等均可）"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isLoading}
        className="h-[42px] rounded-[10px] border-[#e5e7eb] text-sm"
        required
      />
      <Button
        type="submit"
        variant="outline"
        disabled={isLoading || !email}
        className="w-full h-[42px] rounded-[10px] border-[1.5px] border-indigo-200 text-indigo-600 hover:bg-indigo-50 duration-150"
      >
        发送登录链接
      </Button>
    </form>
  );
}
