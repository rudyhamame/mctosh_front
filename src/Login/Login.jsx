import React, { useRef, useState } from "react";
import "./login.css";
import { apiUrl } from "../config/api";
import { writeStoredSession } from "../utils/sessionCleanup";

const Login = ({ onLogin }) => {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const handlePlay = () => {
    videoRef.current?.play();
    setPlaying(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const endpoint = mode === "signup" ? "/api/user/signup" : "/api/user/login";
    const body = mode === "signup"
      ? { username, password, name }
      : { username, password };

    try {
      const res = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error?.message || "Something went wrong.");
        return;
      }

      writeStoredSession(data);
      onLogin(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    setMode((m) => (m === "login" ? "signup" : "login"));
    setError("");
  };

  return (
    <div id="login_page">
      <div id="login_video_wrap">
        <video
          ref={videoRef}
          id="login_video"
          src="https://res.cloudinary.com/dtoxkii3q/video/upload/v1782581889/sample1/user-images/6a237f080175aacbdb3962ff/copy_dbc85ec1-1520-4cba-af16-b27eb6de8979.mp4"
          playsInline
          onEnded={() => setPlaying(false)}
        />
        {!playing && (
          <button id="login_video_play" onClick={handlePlay} aria-label="Play">▶</button>
        )}
      </div>

      <form id="login_form" onSubmit={handleSubmit}>
        <h1>MCTOSH</h1>

        {mode === "signup" && (
          <input
            type="text"
            placeholder="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        )}

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />

        {error && <p id="login_error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        <button type="button" id="login_toggle" onClick={toggle}>
          {mode === "signup" ? "Already have an account? Sign in" : "No account? Sign up"}
        </button>
      </form>
    </div>
  );
};

export default Login;
