"use client";

import type { CSSProperties } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { SandpackErrorBoundary } from "@/components/preview/error-boundary";
import { buildSandpackConfig } from "@/lib/sandpack-config";

const PROVIDER_STYLE: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

interface PreviewFrameProps {
  files: Record<string, string>;
  projectId: string;
  scaffoldDependencies?: Readonly<Record<string, string>>;
}

export function PreviewFrame({ files, projectId, scaffoldDependencies }: PreviewFrameProps) {
  const config = buildSandpackConfig(files, projectId, scaffoldDependencies);
  const appCode = files["/App.js"] ?? "";
  const sandpackKey = `${Object.keys(files).length}-${appCode.length}-${appCode.slice(0, 40)}`;

  return (
    <SandpackErrorBoundary>
      <div className="absolute inset-0 flex flex-col">
        <SandpackProvider
          key={sandpackKey}
          template={config.template as "react"}
          files={config.files}
          options={config.options}
          customSetup={config.customSetup}
          theme={config.theme as "auto"}
          style={PROVIDER_STYLE}
        >
          <SandpackLayout style={{ flex: 1, height: "100%", minHeight: 0, border: "none" }}>
            <SandpackPreview
              style={{ flex: 1, height: "100%", minHeight: 0 }}
              showNavigator={false}
              showOpenInCodeSandbox={false}
              showRefreshButton
            />
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </SandpackErrorBoundary>
  );
}
