import React, { useCallback, useEffect, useState } from 'react';
import { submitFeedback, type FeedbackRequest } from '../services/backendClient';

const CATEGORIES = ['Bug Report', 'Feature Request', 'Question', 'General Feedback'];

export type FeedbackModalProps = {
  isOpen: boolean;
  onClose: () => void;
  backendBaseUrl: string;
  accessToken: string | undefined;
  defaultEmail?: string;
  appVersion?: string;
  platform?: string;
};

export function FeedbackModal({
  isOpen,
  onClose,
  backendBaseUrl,
  accessToken,
  defaultEmail = '',
  appVersion = '',
  platform = 'Desktop',
}: FeedbackModalProps) {
  const [category, setCategory] = useState('Bug Report');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCategory('Bug Report');
      setMessage('');
      setEmail(defaultEmail);
      setStatus('');
      setSending(false);
    }
  }, [isOpen, defaultEmail]);

  const handleSubmit = useCallback(async () => {
    if (!accessToken) {
      setStatus('Please log in first.');
      return;
    }
    setSending(true);
    setStatus('');
    try {
      const baseUrl = backendBaseUrl.trim() || 'https://api.log2goapp.net';
      const payload: FeedbackRequest = {
        category,
        message: message.trim(),
        email: email.trim() || null,
        app_version: appVersion || null,
        platform: platform || null,
      };
      await submitFeedback(baseUrl, accessToken, payload);
      setStatus('Thank you for your feedback!');
      setMessage('');
      setTimeout(onClose, 1500);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${detail}`);
    } finally {
      setSending(false);
    }
  }, [accessToken, backendBaseUrl, category, message, email, appVersion, platform, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Send Feedback</h2>
        <label>
          Category
          <div className="feedback-categories">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`feedback-category-chip ${cat === category ? 'selected' : ''}`}
                onClick={() => setCategory(cat)}
                disabled={sending}
              >
                {cat}
              </button>
            ))}
          </div>
        </label>
        <label>
          Message *
          <textarea
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your feedback..."
            disabled={sending}
          />
        </label>
        <label>
          Your email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={sending}
          />
        </label>
        {status && (
          <div className={`feedback-status ${status.startsWith('Error') || status.startsWith('Please') ? 'error' : 'success'}`}>
            {status}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void handleSubmit()}
            disabled={sending || message.trim().length === 0}
          >
            {sending ? 'Sending...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
