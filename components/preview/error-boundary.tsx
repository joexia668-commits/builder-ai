"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
}

export class SandpackErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[SandpackErrorBoundary]", error);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 bg-gray-50">
          <span className="text-4xl">⚠️</span>
          <p className="text-sm font-medium text-gray-600">渲染失败</p>
          <p className="text-xs text-gray-400">代码存在语法错误，请检查后重试</p>
          <button
            onClick={this.handleRetry}
            className="px-3 py-1.5 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
