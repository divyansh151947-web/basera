"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MessageSquareText, X, ArrowUpRight } from "lucide-react";
import { resolvePublicChatOrgSlug } from "@/lib/public-chat";

const SUGGESTIONS = [
	"3 BHK in Gurgaon under ₹1.5 Cr",
	"2 BHK near Dwarka",
	"Show me properties under ₹1 Cr",
];

type ChatRole = "user" | "assistant";

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
};

/** Window event used by page CTAs (e.g. "Chat with AI Assistant") to open the widget. */
export const OPEN_CHAT_EVENT = "basera:open-chat";

export interface OpenChatEventDetail {
	propertyId?: string;
	/** Set to true by the mounted widget so callers can skip DOM fallbacks. */
	handled?: boolean;
}

interface PublicChatWidgetProps {
	/** When set, chat turns are grounded on this specific property. */
	propertyId?: string;
	/** Title shown in the header instead of the generic "Basera AI" label. */
	contextLabel?: string;
}

export function PublicChatWidget({ propertyId, contextLabel }: PublicChatWidgetProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: "welcome",
			role: "assistant",
			content: contextLabel
				? `Hi! I'm Basera AI 👋\nAsk me anything about ${contextLabel} — price, amenities, possession, or site visits.`
				: "Hi! I'm Basera AI\nTell me what kind of property you're looking for and I'll help you find the best matches.",
		},
	]);
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [leadId, setLeadId] = useState<string | null>(null);
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [offlineNote, setOfflineNote] = useState<string | null>(null);
	const endRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isOpen, isLoading]);

	// Let page-level CTAs open the widget (the launcher button may not exist on
	// every route, so we cannot rely on querying the DOM for it).
	useEffect(() => {
		function handleOpenEvent(event: Event) {
			const detail = (event as CustomEvent<OpenChatEventDetail>).detail;
			const requested = detail?.propertyId;
			// A CTA for a different property than the one this widget is bound to
			// should not silently open a mis-scoped chat.
			if (requested && propertyId && requested !== propertyId) return;
			if (detail) detail.handled = true;
			setIsOpen(true);
		}
		window.addEventListener(OPEN_CHAT_EVENT, handleOpenEvent);
		return () => window.removeEventListener(OPEN_CHAT_EVENT, handleOpenEvent);
	}, [propertyId]);

	async function sendMessage(rawText: string) {
		const text = rawText.trim();
		if (!text || isLoading) return;

		setError(null);
		setInput("");
		setMessages((prev) => [
			...prev,
			{ id: `user-${Date.now()}`, role: "user", content: text },
		]);
		setIsLoading(true);

		try {
			const body: Record<string, string> = {
				orgSlug: resolvePublicChatOrgSlug(process.env.NEXT_PUBLIC_PUBLIC_ORG_SLUG),
				content: text,
			};
			if (leadId) body.leadId = leadId;
			if (conversationId) body.conversationId = conversationId;
			if (propertyId) body.propertyId = propertyId;

			const response = await fetch("/api/public/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			const data = await response.json().catch(() => null);
			if (!response.ok || !data) {
				throw new Error(
					data && typeof data.error === "string" ? data.error : "Request failed"
				);
			}

			if (data.leadId) setLeadId(data.leadId);
			if (data.conversationId) setConversationId(data.conversationId);

			const aiReply =
				typeof data.reply === "string" && data.reply.trim()
					? data.reply.trim()
					: "I didn’t quite catch that. Tell me the city, BHK, or budget you’re considering, and I’ll continue from there.";

			// Honest status: the API tells us whether the live model answered or
			// a local fallback did. Never claim "Online now" for a fallback turn.
			setOfflineNote(
				data.aiStatus === "live"
					? null
					: "Live AI is unavailable right now — these replies come from a limited offline helper."
			);

			setMessages((prev) => [
				...prev,
				{ id: `assistant-${Date.now()}`, role: "assistant", content: aiReply },
			]);
		} catch {
			const recoverReply =
				"I didn’t quite catch that. Tell me the city, BHK, or budget you’re considering, and I’ll continue from there.";
			setMessages((prev) => [
				...prev,
				{
					id: `assistant-${Date.now()}`,
					role: "assistant",
					content: recoverReply,
				},
			]);
			setError("Message not sent — please try again in a moment.");
		} finally {
			setIsLoading(false);
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		sendMessage(input);
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				aria-label="Open Basera AI chat"
				aria-expanded={isOpen}
				className="fixed bottom-5 right-5 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-[0_18px_42px_rgba(15,81,50,0.35)] ring-1 ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-strong focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 md:h-[68px] md:w-[68px]"
			>
				<MessageSquareText size={24} />
			</button>

			{isOpen && (
				<div className="theme-light fixed bottom-24 right-4 z-50 w-[calc(100vw-1.25rem)] max-w-[420px] overflow-hidden rounded-[24px] border border-line bg-panel shadow-float sm:right-5">
					<div className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3.5">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,81,50,0.28)]">
								B
							</div>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold text-ink">{contextLabel ?? "Basera AI"}</p>
								<p className="flex items-center gap-1.5 text-[11px] font-medium text-slate">
									<span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />{" "}
									{offlineNote ? "Offline helper" : "Online now"}
								</p>
							</div>
						</div>

						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="rounded-full p-2 text-slate transition hover:bg-panel-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
							aria-label="Close chat"
						>
							<X size={16} />
						</button>
					</div>

					<div className="flex h-[500px] max-h-[75vh] flex-col bg-[#f7f8f7]">
						<div
							className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4"
							role="log"
							aria-live="polite"
							aria-label="Conversation with Basera AI"
						>
							{messages.map((message) => (
								<div
									key={message.id}
									className={`chat-msg flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
								>
									<div
										className={`max-w-[86%] px-3.5 py-2.5 text-sm leading-relaxed ${
											message.role === "user"
												? "rounded-[18px] rounded-br-md bg-brand text-white shadow-[0_8px_18px_rgba(15,81,50,0.18)]"
												: "rounded-[18px] rounded-bl-md border border-line bg-white text-ink shadow-[0_2px_10px_rgba(16,26,23,0.05)]"
										}`}
										style={{ whiteSpace: "pre-line" }}
									>
										{message.content}
									</div>
								</div>
							))}

							{isLoading && (
								<div className="chat-msg flex justify-start">
									<div className="flex items-center gap-2.5 rounded-[18px] rounded-bl-md border border-line bg-white px-3.5 py-2.5 text-sm text-slate shadow-[0_2px_10px_rgba(16,26,23,0.05)]">
										<span className="typing-dots" aria-hidden>
											<i /><i /><i />
										</span>
										Basera AI is thinking…
									</div>
								</div>
							)}

							{offlineNote && (
								<div className="flex justify-center">
									<div className="max-w-full rounded-full border border-warning/30 bg-warning-soft px-3 py-1.5 text-center text-xs font-medium text-warning">
										{offlineNote}
									</div>
								</div>
							)}

							{error && (
								<div className="flex justify-center">
									<div role="alert" className="max-w-full rounded-full border border-danger/25 bg-danger-soft px-3 py-1.5 text-center text-xs font-medium text-danger">
										{error}
									</div>
								</div>
							)}
							<div ref={endRef} />
						</div>

						<div className="border-t border-line bg-white px-3 py-3">
							<div className="mb-3 flex flex-wrap gap-2">
								{SUGGESTIONS.map((suggestion) => (
									<button
										key={suggestion}
										type="button"
										onClick={() => sendMessage(suggestion)}
										disabled={isLoading}
										className="rounded-full border border-brand/15 bg-brand-soft px-2.5 py-1.5 text-[11px] font-semibold text-brand transition hover:border-brand/30 hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
									>
										{suggestion}
									</button>
								))}
							</div>

							<form onSubmit={handleSubmit} className="flex items-end gap-2">
								<textarea
									rows={1}
									value={input}
									onChange={(event) => setInput(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											sendMessage(input);
										}
									}}
									placeholder="Ask about a property..."
									className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-[#f8faf9] px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-slate/80 focus:border-brand focus:ring-4 focus:ring-brand/10"
									aria-label="Type your property inquiry"
								/>
								<button
									type="submit"
									disabled={!input.trim() || isLoading}
									className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-white transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate/40"
									aria-label="Send message"
								>
									<ArrowUpRight size={18} />
								</button>
							</form>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
