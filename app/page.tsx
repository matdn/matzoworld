"use client";

import React, { useState } from "react";
import Scene from "@/src/components/Scene";

export default function Page() {
  const [started, setStarted] = useState(false);

  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <Scene started={started} />

      {!started ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000000",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <button
            type="button"
            onClick={() => setStarted(true)}
            style={{
              fontSize: 24,
              letterSpacing: 2,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.5)",
              padding: "14px 22px",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            Start
          </button>
        </div>
      ) : null}
    </main>
  );
}
