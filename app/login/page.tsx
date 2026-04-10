import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LoginButton } from "@/components/layout/login-button";
import { GuestLoginButtons } from "@/components/layout/guest-login-buttons";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#eef2ff] via-[#ede9fe] to-[#faf5ff]">
      <div className="bg-white rounded-[20px] shadow-[0_8px_40px_rgba(79,70,229,0.14),0_2px_8px_rgba(0,0,0,0.04)] p-8 w-full max-w-[340px] text-center">

        {/* Logo */}
        <div className="mb-6">
          <h1 className="text-[22px] font-black text-[#030712] tracking-[-0.5px]">
            Builder<span className="text-indigo-600">AI</span>
          </h1>
          <p className="text-[12px] text-[#6b7280] mt-1">
            用自然语言构建 Web 应用
          </p>
        </div>

        {/* Agent cards */}
        <div className="flex gap-2 mb-6">
          {[
            { icon: "📋", role: "PM", label: "需求分析" },
            { icon: "🏗️", role: "Architect", label: "方案设计" },
            { icon: "👨‍💻", role: "Engineer", label: "代码生成" },
          ].map((agent) => (
            <div
              key={agent.role}
              className="flex-1 bg-[#f5f3ff] border border-[#ede9fe] rounded-[12px] py-3 px-2 text-center"
            >
              <div className="text-xl mb-1">{agent.icon}</div>
              <div className="text-[9px] font-bold text-indigo-600">{agent.role}</div>
              <div className="text-[8px] text-[#9ca3af] mt-0.5">{agent.label}</div>
            </div>
          ))}
        </div>

        {/* GitHub login */}
        <LoginButton />

        {/* Divider */}
        <div className="relative my-3">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[#f3f4f6]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-2 text-[#d1d5db]">或</span>
          </div>
        </div>

        {/* Guest login */}
        <GuestLoginButtons />
      </div>
    </div>
  );
}
