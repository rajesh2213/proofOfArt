'use client';

import React, { useState } from 'react';
import { createClaim } from '../../lib/api/art';

interface ClaimModalProps {
    artworkId: string;
    artworkTitle: string;
    onClose: () => void;
}

export default function ClaimModal({ artworkId, artworkTitle, onClose }: ClaimModalProps) {
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            const response = await createClaim(artworkId, reason || undefined);
            if (response.success) {
                setSuccess(true);
                setTimeout(() => {
                    onClose();
                }, 2000);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit claim');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <h2 className="text-2xl font-bold mb-4">Claim Artwork</h2>
                
                {success ? (
                    <div className="text-center py-4">
                        <p className="text-green-600 font-semibold mb-2">Claim submitted successfully!</p>
                        <p className="text-sm text-gray-600">The artwork owner and admin have been notified.</p>
                    </div>
                ) : (
                    <>
                        <p className="text-gray-600 mb-4">
                            You are claiming ownership of: <strong>{artworkTitle}</strong>
                        </p>
                        
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-2">
                                    Reason (optional)
                                </label>
                                <textarea
                                    id="reason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    rows={4}
                                    placeholder="Explain why you are the rightful owner of this artwork..."
                                />
                            </div>

                            {error && (
                                <div className="mb-4 text-red-600 text-sm">{error}</div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                                    disabled={submitting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50"
                                    disabled={submitting}
                                >
                                    {submitting ? 'Submitting...' : 'Submit Claim'}
                                </button>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}

