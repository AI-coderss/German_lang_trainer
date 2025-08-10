import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Navbar from "./components/Navbar";
import "./App.css";

import VoiceAssistantPage from "./pages/VoiceAssistantPage";
import TextChatPage from "./pages/TextChatPage";
import AvatarPage from "./pages/AvatarPage";

import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function App() {
  return (
    <Router>
      <Navbar />

      <Routes>
        {/* Default -> Voice Assistant */}
        <Route path="/" element={<Navigate to="/voice-assistant" replace />} />

        {/* Main pages */}
        <Route path="/voice-assistant" element={<VoiceAssistantPage />} />
        <Route path="/text-chat" element={<TextChatPage />} />
        <Route path="/avatar" element={<AvatarPage />} />

        {/* Catch-all -> Voice Assistant */}
        <Route path="*" element={<Navigate to="/voice-assistant" replace />} />
      </Routes>

      <ToastContainer position="top-right" autoClose={4000} />
    </Router>
  );
}

export default App;

