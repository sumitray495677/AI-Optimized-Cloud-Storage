// src/Login.jsx
import React, { useState } from "react";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    localStorage.setItem("auth", "yes");
    onLogin();
  }

  return (
    <div
      className="w-full flex items-center justify-center"
      style={{ backgroundColor: "#CAF0F8", minHeight: "100vh" }}
    >
      <div className="bg-white shadow-xl rounded-xl p-8 w-full max-w-sm">
        <h2 className="text-2xl font-bold text-center mb-2 text-gray-800">
          Login
        </h2>

        {/* 👋 Welcome line */}
        <p className="text-center text-sm text-black-1000 mb-6">
          Hi! Welcome to your personal cloud storage.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* EMAIL */}
          <div>
            <label className="block text-sm mb-1 text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900 placeholder-gray-400"
              placeholder="Enter email"
            />
          </div>

          {/* PASSWORD */}
          <div>
            <label className="block text-sm mb-1 text-gray-700">Password</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900 placeholder-gray-400"
              placeholder="Enter password"
            />
          </div>

          {/* BUTTON */}
          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg mt-4 font-semibold"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
