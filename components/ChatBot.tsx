
import React, { useState, useRef, useEffect } from 'react';
import { ChatIcon, PaperAirplaneIcon, XIcon, SpinnerIcon } from './Icons';
import { getSupportChatResponse } from '../services/aiService';

interface Message {
  author: 'user' | 'bot';
  message: string;
}

interface ChatBotProps {
  initialMessage?: string;
}

const ChatBot: React.FC<ChatBotProps> = ({ initialMessage = "Hello! I'm the SimuHire Support Assistant. How can I help you today?" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      author: 'bot',
      message: initialMessage,
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages, isLoading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { author: 'user', message: input.trim() };
    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
        const botResponse = await getSupportChatResponse(newMessages);
        const botMessage: Message = { author: 'bot', message: botResponse };
        setMessages(prev => [...prev, botMessage]);
    } catch (error) {
        console.error("Chatbot error:", error);
        const errorMessage: Message = { author: 'bot', message: "Sorry, I'm having trouble connecting. Please try again." };
        setMessages(prev => [...prev, errorMessage]);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <>
      <div className={`fixed bottom-8 right-8 z-30 transition-all duration-300 ${isOpen ? 'opacity-0 scale-90' : 'opacity-100 scale-100'}`}>
        <button
          onClick={() => setIsOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-500"
          aria-label="Open support chat"
        >
          <ChatIcon className="w-8 h-8" />
        </button>
      </div>

      <div
        className={`fixed bottom-8 right-8 z-40 w-[calc(100%-4rem)] max-w-sm h-[70vh] max-h-[600px] bg-slate-800/80 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-700 flex flex-col transition-all duration-300 ease-in-out ${
          isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
        }`}
      >
        <header className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0">
          <h3 className="text-lg font-bold">SimuHire Support</h3>
          <button
            onClick={() => setIsOpen(false)}
            className="text-slate-400 hover:text-white"
            aria-label="Close support chat"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-grow p-4 overflow-y-auto space-y-4">
            {messages.map((msg, index) => (
                <div key={index} className={`flex ${msg.author === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-4 py-2 rounded-xl ${msg.author === 'user' ? 'bg-blue-600 rounded-br-none' : 'bg-slate-700 rounded-bl-none'}`}>
                        <p className="text-white text-sm whitespace-pre-wrap">{msg.message}</p>
                    </div>
                </div>
            ))}
            {isLoading && (
                <div className="flex justify-start">
                    <div className="bg-slate-700 px-4 py-2 rounded-xl rounded-bl-none">
                        <div className="flex items-center space-x-1">
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-150"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-300"></span>
                        </div>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>
        
        <form onSubmit={handleSend} className="p-4 border-t border-slate-700 flex-shrink-0">
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a question..."
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading}
                />
                <button 
                    type="submit" 
                    className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg disabled:bg-slate-500" 
                    disabled={isLoading || !input.trim()}
                    aria-label="Send message"
                >
                   <PaperAirplaneIcon className="w-5 h-5 -mr-0.5 mt-0.5 rotate-90" />
                </button>
            </div>
        </form>
      </div>
    </>
  );
};

export default ChatBot;