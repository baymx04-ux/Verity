import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Tag } from '../../components/ui/tag';
import { Textarea } from '../../components/ui/textarea';
import { useState } from 'react';

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  messageId: string;
  initialRating: 1 | -1 | null;
  onSubmit: (messageId: string, rating: 1 | -1, comment?: string) => Promise<void>;
}

export function FeedbackDialog({
  open,
  onClose,
  messageId,
  initialRating,
  onSubmit,
}: FeedbackDialogProps) {
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackRating] = useState<1 | -1 | null>(initialRating);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const handleSaveComment = async () => {
    if (!feedbackRating) return;
    setIsSubmittingFeedback(true);
    setFeedbackError(null);
    try {
      await onSubmit(messageId, feedbackRating, feedbackComment || undefined);
      setTimeout(() => onClose(), 500);
    } catch (error) {
      setFeedbackError(
        error instanceof Error && error.message
          ? error.message
          : 'Your comment could not be saved. Please try again.',
      );
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Leave Answer Feedback"
      description="Your feedback is stored with this answer for later review."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-label-md">
          <span>Rating:</span>
          <Tag variant={feedbackRating === 1 ? 'verified' : 'danger'}>
            {feedbackRating === 1 ? 'Helpful' : 'Unhelpful'}
          </Tag>
        </div>
        <div>
          <label htmlFor="feedback-comment" className="block text-label-md text-ink-700 mb-1">
            Comment (optional)
          </label>
          <Textarea
            id="feedback-comment"
            value={feedbackComment}
            onChange={(e) => setFeedbackComment(e.target.value)}
            placeholder="What could be improved or verified more accurately?"
            rows={3}
          />
        </div>
        {feedbackError ? (
          <p
            role="alert"
            className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-text"
          >
            {feedbackError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isSubmittingFeedback}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveComment}
            disabled={isSubmittingFeedback || !feedbackRating}
          >
            {isSubmittingFeedback ? 'Saving…' : 'Save feedback'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
