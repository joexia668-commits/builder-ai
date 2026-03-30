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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border p-8 w-full max-w-sm text-center">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Builder<span className="text-indigo-600">AI</span>
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            AI Agent 驱动的代码生成平台
          </p>
        </div>

        <div className="space-y-3 text-left mb-6">
          {[
            { icon: "📋", text: "PM 分析需求" },
            { icon: "🏗️", text: "Architect 设计方案" },
            { icon: "👨‍💻", text: "Engineer 生成代码" },
          ].map((item) => (
            <div key={item.text} className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-base">{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>

        <LoginButton />

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-gray-400">或</span>
          </div>
        </div>

        <GuestLoginButtons />
      </div>
    </div>
  );
}
