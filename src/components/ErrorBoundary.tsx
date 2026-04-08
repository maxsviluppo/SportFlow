import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: ''
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, errorMessage: error.message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong. Please try again later.";
      
      // Attempt to parse Firestore JSON error
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed.error && parsed.operationType) {
          displayMessage = `Firestore Error: ${parsed.error} during ${parsed.operationType} on ${parsed.path || 'unknown path'}.`;
        }
      } catch (e) {
        // Not a JSON error, use default or original message
      }

      return (
        <div className="flex flex-col items-center justify-center h-screen bg-black text-white p-6 text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border border-red-500/50">
            <span className="text-red-500 text-2xl font-bold">!</span>
          </div>
          <h2 className="text-xl font-bold mb-4 text-red-500">Application Error</h2>
          <p className="text-zinc-400 max-w-md mb-8 font-mono text-sm leading-relaxed">
            {displayMessage}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-neon-blue/20 border border-neon-blue/50 text-neon-blue rounded-full text-xs font-bold tracking-widest hover:bg-neon-blue/30 transition-all"
          >
            RELOAD APPLICATION
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
