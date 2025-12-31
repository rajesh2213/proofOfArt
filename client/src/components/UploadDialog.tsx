'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Image from 'next/image';
import gsap from 'gsap';
import { useRouter, usePathname } from 'next/navigation';
import { uploadImage } from '../lib/api/upload';
import { useAuth } from '../contexts/AuthContext';

export type UploadResult = {
  success: boolean;
  message: string;
  errorCode?: string;
  data?: {
    file: {
      originalName: string;
      mimetype: string;
      size: number;
      hash: string;
    };
    inference: any;
    imageUrl?: string;
    imageId?: string;
  };
};

export type ImageMetaData = {
  type: string;
  isMadeByUser: boolean;
  imageTitle: string;
  allowAITraining: boolean;
  creationDate: string;
};

type UploadDialogProps = {
  onUploadClick?: (onAnimationComplete: () => void) => void;
  dialogRef?: React.RefObject<HTMLDivElement>;
  onUploadComplete: ({status, imageUrl, inference, imageId}: {status: boolean, imageUrl: string | null, inference: any, imageId?: string | null}) => void;
};

const UploadDialog: React.FC<UploadDialogProps> = ({ onUploadClick, dialogRef: externalDialogRef, onUploadComplete }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [claimEvidenceFile, setClaimEvidenceFile] = useState<File | null>(null);
  const [actionAlertMessage, setActionAlertMessage] = useState<string>('');
  const [showActionAlert, setShowActionAlert] = useState(false);
  const claimEvidenceFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageType, setImageType] = useState<string>('');
  const [isMadeByUser, setIsMadeByUser] = useState<boolean | null>(null);
  const [imageTitle, setImageTitle] = useState<string>('');
  const [creationDate, setCreationDate] = useState<string>('');
  const [allowAITraining, setAllowAITraining] = useState<boolean>(false);
  const [contactName, setContactName] = useState<string>('');
  const [isUploadStarting, setIsUploadStarting] = useState<boolean>(false);
  const internalDialogRef = useRef<HTMLDivElement>(null);
  const dialogRef = externalDialogRef || internalDialogRef;

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  const maxSize = 100 * 1024 * 1024;

  useEffect(() => {
    if (!isAuthenticated && isMadeByUser === true) {
      setIsMadeByUser(false);
    }
  }, [isAuthenticated, isMadeByUser]);

  const validateFile = (file: File): string | null => {
    if (!allowedTypes.includes(file.type)) {
      return 'Only images (JPG, PNG, JPEG) are allowed';
    }
    if (file.size > maxSize) {
      return 'File too large. Maximum size is 100MB';
    }
    return null;
  };

  const handleFileSelect = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSelectedFile(file);
    setResult(null);
    setImageLoaded(false);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const reader = new FileReader();
    reader.onloadend = (e) => {
      if (reader.result && typeof reader.result === 'string') {
        setPreviewUrl(reader.result);
      } else {
        setError('Failed to load image preview');
      }
    };
    reader.onerror = () => {
      setError('Failed to read image file');
    };
    reader.readAsDataURL(file);

  }, [previewUrl]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (!imageType) {
      setError('Please select an Image Type');
      return;
    }
    if (isMadeByUser === null) {
      setError('Please confirm if this art is made by you');
      return;
    }
    if (isMadeByUser === true && !isAuthenticated) {
      setError('You must be logged in to claim images as your own artwork');
      return;
    }
    if (isMadeByUser === true) {
      if (!imageTitle.trim()) {
        setError('Please provide an Image Title');
        return;
      }
      if (!creationDate) {
        setError('Please provide a Creation Date');
        return;
      }
      if (creationDate > new Date().toISOString()) {
        setError('Creation Date cannot be in the future');
        return;
      }
    }

    if (onUploadClick) {
      setIsUploadStarting(true);
      setIsUploading(true);
      setUploadProgress(1);
      onUploadClick(() => {
        if (selectedFile) {
          performUpload(selectedFile, 'insert', {
            type: imageType,
            isMadeByUser: isMadeByUser,
            imageTitle: imageTitle,
            allowAITraining: allowAITraining,
            creationDate: creationDate,
          }, claimEvidenceFile);
        }
      });
    } else {
      if (selectedFile) {
        performUpload(selectedFile, 'insert', {
          type: imageType,
          isMadeByUser: isMadeByUser,
          imageTitle: imageTitle,
          allowAITraining: allowAITraining,
          creationDate: creationDate,
        } as ImageMetaData, claimEvidenceFile);
      }
    }
  };

  const handleUpdate = () => {
    setShowActionAlert(false);
    setError(null);
    if (selectedFile && isMadeByUser !== null) {
      performUpload(selectedFile, 'update', {
        type: imageType,
        isMadeByUser: isMadeByUser,
        imageTitle: imageTitle,
        allowAITraining: allowAITraining,
        creationDate: creationDate,
      }, claimEvidenceFile);
    }
  };

  const handleDismissAlert = () => {
    setShowActionAlert(false);
    setActionAlertMessage('');
  };

  const handleResponseFailure = (res: UploadResult): void => {
    switch(res.errorCode) {
      case "IMAGE_ALREADY_CLAIMED":
        setActionAlertMessage('This image has already been claimed by you. Would you like to update your claim with new information?');
        setShowActionAlert(true);
        setError(null);
        break;
      default:
        setError('Upload failed');
        break;
    }
  }

  const performUpload = async (file: File, action: 'insert' | 'update', imageMetaData: ImageMetaData, claimEvidence?: any) => {
    setIsUploading(true);
    setUploadProgress(1);
    setError(null);
    setShowActionAlert(false);
    setActionAlertMessage('');

    try {
      const res = await uploadImage(file, imageMetaData, claimEvidence, (p: number) => setUploadProgress(p), action) as UploadResult;
      if(res && res.success === false) {
        handleResponseFailure(res);
      } else if (res && res.success) {
        setResult(res);
        onUploadComplete({
          status: true,
          imageUrl: res.data?.imageUrl || null,
          inference: res.data?.inference || null,
          imageId: res.data?.imageId || null,
        });
        setShowActionAlert(false);
        setActionAlertMessage('');
        if (pathname !== '/upload-art') {
          setTimeout(() => {
            router.push('/upload-art');
          }, 1500);
        }
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setShowActionAlert(false);
      setActionAlertMessage('');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleClose = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setError(null);
    setResult(null);
    setUploadProgress(0);
    setImageLoaded(false);
    setShowImageModal(false);
    setImageType('');
    setIsMadeByUser(null);
    setImageTitle('');
    setCreationDate('');
    setAllowAITraining(false);
    setContactName('');
    setClaimEvidenceFile(null);
    setIsUploadStarting(false); 
    
    if (isSidebarMode) {
      onUploadComplete({
        status: false,
        imageUrl: null,
        inference: null,
      });
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isSidebarMode = result && result.success;
  
  return (
    <div className={`flex gap-10 items-center justify-center pointer-events-none p-4 w-full relative ${isSidebarMode ? 'h-full' : ''}`}>
      <div 
        ref={dialogRef}
        className={`rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col relative z-10 ${isSidebarMode ? 'w-full h-full' : 'w-full md:w-[90%] lg:w-[90%] max-h-[80vh]'}`}
        style={{
          maxWidth: isSidebarMode ? '100%' : (isMadeByUser === true ? '90%' :'45%'),
          transition: isUploadStarting ? 'all 0.5s ease-out' : 'max-width 0.2s ease-in-out',
          background: isUploadStarting 
            ? "rgba(255, 255, 255, 0.95)" 
            : isSidebarMode
            ? "rgba(255, 255, 255, 0.95)"
            : "rgba(255, 255, 255, 0.08)",
          backdropFilter: isUploadStarting 
            ? "blur(40px) saturate(180%)" 
            : isSidebarMode
            ? "blur(40px) saturate(180%)"
            : "blur(24px) saturate(200%)",
          border: isUploadStarting 
            ? "2px solid rgba(255, 255, 255, 0.2)" 
            : isSidebarMode
            ? "2px solid rgba(255, 255, 255, 0.2)"
            : "0.5px solid rgba(0, 0, 0, 0.9)",
          borderRadius: isSidebarMode ? "1rem" : undefined,
          boxShadow: isUploadStarting 
            ? `
              0 20px 60px rgba(255, 255, 255, 0.2),
              0 0 0 1px rgba(255, 255, 255, 0.3),
              inset 0 2px 4px rgba(255, 255, 255, 0.9),
              inset 0 -2px 4px rgba(255, 255, 255, 0.6),
              inset 0 0 20px rgba(255, 255, 255, 0.4)
            `
            : isSidebarMode
            ? `
              0 20px 60px rgba(255, 255, 255, 0.2),
              0 0 0 1px rgba(255, 255, 255, 0.3),
              inset 0 2px 4px rgba(255, 255, 255, 0.9),
              inset 0 -2px 4px rgba(255, 255, 255, 0.6),
              inset 0 0 20px rgba(255, 255, 255, 0.4)
            `
            : `
              0 8px 32px rgba(0, 0, 0, 0.9),
              0 0 0 1px rgba(0, 0, 0, 0.8),
              inset 0 1px 1px rgba(255, 255, 255, 0.9),
              inset 0 -1px 1px rgba(0, 0, 0, 0.8),
              inset 0 0 0 1px rgba(0, 0, 0, 0.3)
            `,
          WebkitBackdropFilter: isUploadStarting 
            ? "blur(40px) saturate(180%)" 
            : isSidebarMode
            ? "blur(40px) saturate(180%)"
            : "blur(24px) saturate(200%)",
          fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
        }}
      >
        {(
          <div className={`px-5 pt-5 pb-2 text-center border-b ${isUploadStarting ? 'border-black/20' : 'border-black/30'}`}>
            <h3 className={`text-base md:text-lg lg:text-xl leading-relaxed drop-shadow-md ${isUploadStarting ? 'text-black' : 'text-white'}`}
                style={{
                    letterSpacing: '0.05em',
                    textShadow: isUploadStarting
                      ? '0 1px 2px rgba(0, 0, 0, 0.1)' 
                      : '0 2px 4px rgba(0, 0, 0, 0.7), 0 0 8px rgba(255, 255, 255, 0.3), 0 1px 2px rgba(0, 0, 0, 0.9)',
                    fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                }}
            >
              Upload your art to authenticate it—or analyze any image for AI generation or tampering
            </h3>
          </div>
        )}
        <div className={`p-5 ${isSidebarMode ? 'overflow-hidden' : 'overflow-y-auto'} flex-1`}>
          {!selectedFile && (
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300 ${isDragOver
                  ? 'border-white/60 bg-black/80 scale-105'
                  : 'border-white/30 hover:border-white/50 bg-black/60 hover:bg-black/70'
                }`}
              style={{ backdropFilter: "blur(8px)", boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.1)" }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center space-y-3">
                <div className="p-3 rounded-full border-2 border-white/30" style={{ background: "rgba(255, 182, 193, 0.15)", backdropFilter: "blur(8px)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)" }}>
                  <svg className="h-8 w-8 text-pink-300 drop-shadow-sm" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <p className={`text-sm drop-shadow-sm ${isUploadStarting ? 'text-black' : 'text-white'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={`font-semibold hover:text-pink-200 cursor-pointer transition-colors duration-200 underline decoration-2 underline-offset-2 drop-shadow-sm ${isUploadStarting ? 'text-pink-600' : 'text-pink-300'}`}
                      style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                    >
                      Click to upload
                    </button>
                    {' '}or drag and drop
                  </p>
                  <p className={`text-xs drop-shadow-sm ${isUploadStarting ? 'text-black/70' : 'text-white/80'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                    PNG, JPG, JPEG up to 100MB
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          )}

          {/* File Preview */}
          {selectedFile && !result && (
            <div className={`grid gap-4 ${isMadeByUser === true ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2'}`}>
              {/* Left Column - Image Preview */}
              <div className={`space-y-4 ${isMadeByUser === true ? 'lg:col-span-1' : ''}`}>
              <div className="relative group">
                {previewUrl && (
                  <div className="relative rounded-xl overflow-hidden border-2 border-white/30 bg-white/10 backdrop-blur-sm flex items-center justify-center" style={{ minHeight: '200px', maxHeight: '250px', boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2)" }}>
                    {!imageLoaded && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm">
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-300 mx-auto mb-2"></div>
                          <p className={`text-sm drop-shadow-sm ${isUploadStarting ? 'text-black/70' : 'text-white/80'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Loading preview...</p>
                        </div>
                      </div>
                    )}
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className={`max-w-full max-h-full transition-all duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'} cursor-pointer`}
                      onLoad={() => setImageLoaded(true)}
                      onError={() => setError('Failed to load image preview')}
                      onClick={() => setShowImageModal(true)}
                      style={{
                        objectFit: 'contain',
                        display: 'block'
                      }}
                    />
                    <div className="absolute inset-0 bg-transparent group-hover:bg-black/20 transition-all duration-300 flex items-center justify-center pointer-events-none">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div className="bg-white/20 backdrop-blur-sm rounded-full p-3 shadow-lg border-2 border-white/30">
                          <svg className="w-8 h-8 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </div>

              <div className={`p-4 rounded-xl border-2 ${isUploadStarting ? 'border-black/20 bg-white/30' : 'border-black/40 bg-white/10'} backdrop-blur-sm ${isMadeByUser === true ? 'lg:col-span-2' : ''}`} style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.2)" }}>
                <h3 className={`font-semibold mb-4 text-sm border-b ${isUploadStarting ? 'text-black border-black/10' : 'text-white border-black/20'} pb-2`} style={{ letterSpacing: "0.01em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace", textShadow: isUploadStarting ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.5)' }}>Image Information</h3>

                <div className={isMadeByUser === true ? "grid grid-cols-1 md:grid-cols-2 gap-4" : ""}>
                  <div>
                    <div className="mb-4">
                      <label className={`block mb-2 text-xs font-medium ${isUploadStarting ? 'text-black/90' : 'text-white/90'}`} style={{ letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                        Image Type <span className={isUploadStarting ? 'text-pink-600' : 'text-pink-300'}>*</span>
                      </label>
                      <select
                        value={imageType}
                        onChange={(e) => setImageType(e.target.value)}
                        className={`w-full px-3 py-2 text-xs rounded-lg border-2 transition-colors ${isUploadStarting ? 'border-black/30 bg-white/50 text-black' : 'border-white/30 bg-white/10 text-white'} focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-200`}
                        style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                      >
                        <option value="" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: 'white' }}>Select type...</option>
                        <option value="real-photo" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: 'white' }}>Real artwork (hand-drawn or digital)</option>
                        <option value="ai-generated" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: 'white' }}>AI-generated artwork</option>
                        <option value="ai-edited" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: 'white' }}>AI-edited / AI-enhanced</option>
                        <option value="not-sure" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: 'white' }}>Not sure</option>
                      </select>
                    </div>

                    <div className="mb-4">
                      <label className={`block mb-2 text-xs font-medium ${isUploadStarting ? 'text-black/90' : 'text-white/90'}`} style={{ letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                        Made by you? <span className={isUploadStarting ? 'text-pink-600' : 'text-pink-300'}>*</span>
                      </label>
                      {!isAuthenticated && (
                        <div className="mb-2 p-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 backdrop-blur-sm">
                          <p className="text-xs text-yellow-300" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                            You must be logged in to claim images as your own artwork.
                          </p>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <label className={`flex items-center ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                          <input
                            type="radio"
                            name="isMadeByUser"
                            checked={isMadeByUser === true}
                            onChange={() => {
                              if (isAuthenticated) {
                                setIsMadeByUser(true);
                              }
                            }}
                            disabled={!isAuthenticated}
                            className="w-3.5 h-3.5 text-pink-300 border-white/30 focus:ring-pink-200 disabled:cursor-not-allowed"
                            style={{ accentColor: "black" }}
                          />
                          <span className={`ml-2 text-xs ${isUploadStarting ? 'text-black/80' : 'text-white/80'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Yes</span>
                        </label>
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="radio"
                            name="isMadeByUser"
                            checked={isMadeByUser === false}
                            onChange={() => setIsMadeByUser(false)}
                            className={`w-3.5 h-3.5 ${isUploadStarting ? 'text-pink-600 border-black/30' : 'text-pink-300 border-white/30'} focus:ring-pink-200`}
                            style={{ accentColor: 'black' }}
                          />
                          <span className={`ml-2 text-xs ${isUploadStarting ? 'text-black/80' : 'text-white/80'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>No</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {isMadeByUser === true && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="mb-4">
                          <label className={`block mb-2 text-xs font-medium ${isUploadStarting ? 'text-black/90' : 'text-white/90'}`} style={{ letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                            Title <span className={isUploadStarting ? 'text-pink-600' : 'text-pink-300'}>*</span>
                          </label>
                          <input
                            type="text"
                            value={imageTitle}
                            onChange={(e) => setImageTitle(e.target.value)}
                            placeholder="Enter title"
                            className={`w-full px-3 py-2 text-xs rounded-lg border-2 backdrop-blur-sm transition-colors ${isUploadStarting ? 'border-black/30 bg-white/50 text-black placeholder-black/50' : 'border-white/30 bg-white/10 text-white placeholder-white/50'} focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-200`}
                            style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2)", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                          />
                        </div>

                        <div className="mb-4">
                          <label className={`block mb-2 text-xs font-medium ${isUploadStarting ? 'text-black/90' : 'text-white/90'}`} style={{ letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                            Creation Date <span className={isUploadStarting ? 'text-pink-600' : 'text-pink-300'}>*</span>
                          </label>
                          <input
                            type="date"
                            value={creationDate}
                            onChange={(e) => setCreationDate(e.target.value)}
                            className={`w-full px-3 py-2 text-xs rounded-lg border-2 transition-colors ${isUploadStarting ? 'border-black/30 bg-white/50 text-black' : 'border-white/30 bg-white/10 text-white'} focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-200`}
                            style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="mb-4">
                          <label className={`block mb-2 text-xs font-medium ${isUploadStarting ? 'text-black/90' : 'text-white/90'}`} style={{ letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                            AI Training
                          </label>
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allowAITraining}
                              onChange={(e) => setAllowAITraining(e.target.checked)}
                              className={`w-3.5 h-3.5 rounded focus:ring-pink-200 ${isUploadStarting ? 'text-pink-600 border-black/30' : 'text-pink-300 border-white/30'}`}
                              style={{ accentColor: "#f9a8d4" }}
                            />
                            <span className={`ml-2 text-xs ${isUploadStarting ? 'text-black/80' : 'text-white/80'}`} style={{ letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                              Allow AI train on this image?
                            </span>
                          </label>
                        </div>
                        <div className="mb-4">
                          <label className={`block mb-2 text-xs font-medium ${isUploadStarting ? 'text-black/90' : 'text-white/90'}`} style={{ letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                            Claim Evidence
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => claimEvidenceFileInputRef.current?.click()}
                              className={`px-3 py-2 text-xs rounded-lg border-2 backdrop-blur-sm transition-colors font-medium ${isUploadStarting ? 'border-black/30 bg-white/50 text-black hover:bg-white/70 hover:border-pink-600' : 'border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-pink-300'} focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-200`}
                              style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2)", letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                            >
                              {claimEvidenceFile ? 'Change File' : 'Attach File'}
                            </button>
                            {claimEvidenceFile && (
                              <span className={`text-xs truncate max-w-[150px] ${isUploadStarting ? 'text-black/70' : 'text-white/70'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                                {claimEvidenceFile.name}
                              </span>
                            )}
                          </div>
                          <input 
                            ref={claimEvidenceFileInputRef} 
                            type="file" 
                            onChange={(e) => setClaimEvidenceFile(e.target.files?.[0] || null)}
                            className="hidden"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {selectedFile && !result && (
            <div className="mt-4 space-y-3 border-t-2 border-white/20 pt-4">
              {isUploading && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className={`font-medium ${isUploadStarting ? 'text-black/80' : 'text-white/80'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Uploading...</span>
                    <span className="font-semibold text-pink-300" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden border border-white/30">
                    <div
                      className="bg-pink-500 h-1.5 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex space-x-3">
                <button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="flex-1 bg-pink-500 text-white font-semibold py-2 px-4 rounded-xl border-2 border-black transition-all duration-200 transform hover:scale-101 hover:bg-pink-600 disabled:scale-100 disabled:cursor-not-allowed disabled:opacity-50 text-sm shadow-lg"
                  style={{ boxShadow: "0 4px 12px rgba(236, 72, 153, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.3)", letterSpacing: "0.02em", cursor: isUploading ? 'not-allowed' : 'pointer' }}
                >
                  {isUploading ? (
                    <div className="flex items-center justify-center space-x-2">
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Uploading...</span>
                    </div>
                  ) : (
                    'Upload'
                  )}
                </button>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    if (previewUrl) {
                      URL.revokeObjectURL(previewUrl);
                      setPreviewUrl(null);
                    }
                    setError(null);
                    setImageType('');
                    setIsMadeByUser(null);
                    setImageTitle('');
                    setCreationDate('');
                    setAllowAITraining(false);
                    setContactName('');
                    setClaimEvidenceFile(null);
                    onUploadComplete({
                      status: false,
                      imageUrl: null,
                      inference: null,
                    });
                  }}
                  disabled={isUploading}
                  className={`px-4 py-2 border-2 rounded-xl transition-all duration-200 font-semibold disabled:cursor-not-allowed disabled:opacity-50 text-sm ${isUploadStarting ? 'border-black/30 text-black hover:bg-white/70 bg-white/50' : 'border-white/30 text-white hover:bg-white/20 bg-white/10'}`}
                  style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2)", letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showActionAlert && (
            <div className="mt-4 p-4 rounded-xl border-2 border-pink-300/50 bg-pink-500/10 backdrop-blur-sm" style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2), 0 0 0 1px rgba(249, 168, 212, 0.3)" }}>
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <svg className="w-5 h-5 text-pink-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-pink-300 mb-2 text-sm" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                    Image Already Claimed
                  </h4>
                  <p className={`text-xs mb-4 ${isUploadStarting ? 'text-black/80' : 'text-white/80'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                    {actionAlertMessage}
                  </p>
                  <div className="flex space-x-3">
                    <button
                      onClick={handleUpdate}
                      disabled={isUploading}
                      className="px-4 py-2 bg-pink-500 text-white font-semibold rounded-lg border-2 border-pink-300 transition-all duration-200 transform hover:scale-105 hover:bg-pink-600 disabled:scale-100 disabled:cursor-not-allowed disabled:opacity-50 text-xs shadow-lg"
                      style={{ boxShadow: "0 4px 12px rgba(236, 72, 153, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.3)", letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                    >
                      {isUploading ? 'Updating...' : 'Update Claim'}
                    </button>
                    <button
                      onClick={handleDismissAlert}
                      disabled={isUploading}
                      className={`px-4 py-2 border-2 rounded-lg transition-all duration-200 font-semibold disabled:cursor-not-allowed disabled:opacity-50 text-xs ${isUploadStarting ? 'border-black/30 text-black hover:bg-white/70 bg-white/50' : 'border-white/30 text-white hover:bg-white/20 bg-white/10'}`}
                      style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2)", letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 rounded-xl border-2 border-white/30 bg-white/10 backdrop-blur-sm" style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2), 0 0 0 1px rgba(249, 168, 212, 0.2)" }}>
              <div className="flex items-start space-x-2">
                <div className="flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-semibold text-red-600 mb-1 text-sm">Upload Error</h4>
                  <p className={`text-xs ${isUploadStarting ? 'text-black/80' : 'text-white/80'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{error}</p>
                </div>
              </div>
            </div>
          )}

          {result && result.success && (
            <div className={`${isSidebarMode ? 'mt-0 space-y-4' : 'mt-5 space-y-5'}`}>
              {isSidebarMode ? (
                <>
                  {result.data && (
                    <div className="p-4 rounded-lg border border-black/10 bg-white/50 backdrop-blur-sm">
                      <h3 className="font-semibold mb-3 text-sm text-black" style={{ letterSpacing: "0.01em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Upload Details</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center py-1.5 border-b border-black/10">
                          <span className="font-medium text-xs text-black/70" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>File:</span>
                          <span className="truncate max-w-32 text-xs text-black" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{result.data.file.originalName}</span>
                        </div>
                        <div className="flex justify-between items-center py-1.5 border-b border-black/10">
                          <span className="font-medium text-xs text-black/70" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Size:</span>
                          <span className="text-xs text-black" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{formatFileSize(result.data.file.size)}</span>
                        </div>
                        <div className="flex justify-between items-center py-1.5">
                          <span className="font-medium text-xs text-black/70" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Hash:</span>
                          <span className="font-mono text-xs text-black" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{result.data.file.hash.substring(0, 12)}...</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handleClose}
                    className="w-full bg-pink-500 text-white font-semibold py-2.5 px-4 rounded-lg border-2 border-white/30 transition-all duration-200 transform hover:scale-105 hover:bg-pink-600 shadow-lg text-sm cursor-pointer"
                    style={{ boxShadow: "0 4px 12px rgba(236, 72, 153, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.3)", letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                  >
                    Close
                  </button>
                </>
              ) : (
                <>
                  {result.data && (
                    <div className="p-5 rounded-lg border-2 border-white/30 bg-white/10 backdrop-blur-sm" style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2)" }}>
                      <h3 className={`font-semibold mb-4 text-base ${isUploadStarting ? 'text-black' : 'text-white'}`} style={{ letterSpacing: "0.01em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Upload Details</h3>
                      <div className="space-y-3">
                        <div className={`flex justify-between items-center py-2 border-b-2 ${isUploadStarting ? 'border-black/20' : 'border-white/20'}`}>
                          <span className={`font-medium text-sm ${isUploadStarting ? 'text-black/70' : 'text-white/70'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>File:</span>
                          <span className={`truncate max-w-48 text-sm ${isUploadStarting ? 'text-black' : 'text-white'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{result.data.file.originalName}</span>
                        </div>
                        <div className={`flex justify-between items-center py-2 border-b-2 ${isUploadStarting ? 'border-black/20' : 'border-white/20'}`}>
                          <span className={`font-medium text-sm ${isUploadStarting ? 'text-black/70' : 'text-white/70'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Size:</span>
                          <span className={`text-sm ${isUploadStarting ? 'text-black' : 'text-white'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{formatFileSize(result.data.file.size)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className={`font-medium text-sm ${isUploadStarting ? 'text-black/70' : 'text-white/70'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Hash:</span>
                          <span className={`font-mono text-sm ${isUploadStarting ? 'text-black' : 'text-white'}`} style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>{result.data.file.hash.substring(0, 16)}...</span>
                        </div>
                      </div>

                      {result.data.inference && (
                        <div className="mt-5">
                          <h4 className="font-semibold text-white mb-3 text-base" style={{ letterSpacing: "0.01em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>Inference Results</h4>
                          <div className="p-4 rounded-lg border-2 border-white/30 max-h-48 overflow-y-auto bg-white/10" style={{ boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.2)" }}>
                            <pre className="text-xs text-white/80 whitespace-pre-wrap" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                              {JSON.stringify(result.data.inference, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleClose}
                      className="w-full bg-pink-500 text-white font-semibold py-3 px-6 rounded-lg border-2 border-white/30 transition-all duration-200 transform hover:scale-105 hover:bg-pink-600 shadow-lg cursor-pointer"
                      style={{ boxShadow: "0 4px 12px rgba(236, 72, 153, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.3)", letterSpacing: "0.02em", fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showImageModal && previewUrl && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm pointer-events-auto" onClick={() => setShowImageModal(false)}>
          <div className="relative max-w-[90vw] max-h-[90vh] p-4">
            <button
              onClick={() => setShowImageModal(false)}
              className="absolute -top-2 -right-2 z-10 bg-white dark:bg-gray-800 rounded-full p-2 shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
            >
              <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={previewUrl}
              alt="Full size preview"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadDialog;
