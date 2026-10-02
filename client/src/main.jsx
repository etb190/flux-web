import React from 'react';
import { createRoot } from 'react-dom/client';
// Web fluxAPI bridge (HTTP + SSE) — must install window.fluxAPI before
// any component/hook that reads it renders.
import './lib/fluxAPI.js';
import App from './App.jsx';
import './styles.css';

// Last-resort boundary: a render error shows a recovery pane instead of a
// white window. "Reload" re-mounts the whole tree from scratch.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex flex-col items-center justify-center gap-4 bg-bg text-ink px-6 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-dim max-w-md text-sm break-words">
            {String(this.state.error && this.state.error.message || this.state.error)}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white hover:brightness-110"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
