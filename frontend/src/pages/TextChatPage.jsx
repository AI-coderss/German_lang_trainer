import React, { Suspense } from "react";
const Chat = React.lazy(() => import("../components/Chat"));

const TextChatPage = () => {
  return (
    <div className="page page--text-chat">
      <Suspense fallback={<div style={{ padding: 24 }}>Loading chat…</div>}>
        <Chat />
      </Suspense>
    </div>
  );
};

export default TextChatPage;
