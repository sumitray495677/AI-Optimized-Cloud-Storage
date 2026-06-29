import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import Login from "./Login";
import "./index.css";

const queryClient = new QueryClient();

function RootApp() {
  const [loggedIn, setLoggedIn] = useState(
    localStorage.getItem("auth") === "yes"
  );

  function handleLogin() {
    setLoggedIn(true);
  }

  return (
    <QueryClientProvider client={queryClient}>
      {loggedIn ? <App /> : <Login onLogin={handleLogin} />}
    </QueryClientProvider>
  );
}

const container = document.getElementById("root");
createRoot(container).render(<RootApp />);
