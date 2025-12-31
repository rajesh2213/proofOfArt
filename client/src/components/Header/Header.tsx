'use client';

import React, { forwardRef, useState, useEffect, useRef } from 'react';
import { UserCircle, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLoaderContext } from '../../contexts/LoaderContext';
import { useUI } from '../../contexts/UIContext';
import { useAuth } from '../../contexts/AuthContext';
import HomePageClient from '../Home/HomePageClient';
import { usePathname } from 'next/navigation';
import gsap from 'gsap';

let hasBeenVisibleGlobal = false;

const Header = forwardRef(function Header(props, ref) {
    const router = useRouter();
    const { isLoading, loaderConfig, startLoader } = useLoaderContext();
    const { paintDripState, setPaintDripState, setIsScrollSceneActive, setShowContent, hideHeader } = useUI();
    const { isAuthenticated, user, logout } = useAuth();
    const [isVisible, setIsVisible] = useState(false);
    const [hasLoaderStarted, setHasLoaderStarted] = useState(false);
    const [isDropDownMenuOpen, setIsDropDownMenuOpen] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const pathname = usePathname();
    
    useEffect(() => {
        setIsDropDownMenuOpen(false);
        setIsUserMenuOpen(false);
    }, [pathname]);
    const headerRef = useRef<HTMLElement | null>(null);
    const hasAnimatedRef = useRef(false);
    const headerContentRef = useRef<HTMLDivElement | null>(null);
    const titleRef = useRef<HTMLAnchorElement | null>(null);
    const menuButtonRef = useRef<HTMLButtonElement | null>(null);
    const userIconRef = useRef<SVGSVGElement | null>(null);
    const userMenuRef = useRef<HTMLDivElement | null>(null);
    const galleryMenuRef = useRef<HTMLDivElement | null>(null);
    const closeMenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isUploadArtPage = pathname === '/upload-art';
    const isGalleryPage = pathname === '/gallery';
    const isAuthPage = pathname === '/login' || pathname === '/register'
    const [isMounted, setIsMounted] = useState(false);
    const lastAnimatedPathnameRef = useRef<string | null>(null);
    
    useEffect(() => {
        if (isGalleryPage || isUploadArtPage) {
            if (!isVisible) {
                setIsVisible(true);
                hasBeenVisibleGlobal = true;
            }
            return;
        }

        if (isLoading || loaderConfig) {
            setHasLoaderStarted(true);
            setIsVisible(false);
            hasAnimatedRef.current = false;
            if (pathname === '/') {
                lastAnimatedPathnameRef.current = null;
            }
        } else if (hasLoaderStarted || !hasBeenVisibleGlobal) {
            const shouldAnimate = 
                !hasAnimatedRef.current && 
                headerRef.current &&
                (pathname !== lastAnimatedPathnameRef.current || (pathname === '/' && lastAnimatedPathnameRef.current === null));
            
            if (shouldAnimate) {
                const revealTimer = setTimeout(() => {
                    if (headerRef.current && !hasAnimatedRef.current) {
                        hasAnimatedRef.current = true;
                        lastAnimatedPathnameRef.current = pathname;
                        setIsVisible(true);
                        hasBeenVisibleGlobal = true;
                        
                        if (paintDripState === 1) {
                            gsap.fromTo(headerRef.current, 
                                {
                                    opacity: 0,
                                    y: -30,
                                    scale: 0.9,
                                },
                                {
                                    opacity: 1,
                                    y: 0,
                                    scale: 1,
                                    duration: 1.0,
                                    delay: 0.2,
                                    ease: "power2.out",
                                }
                            );
                        } else {
                            gsap.fromTo(headerRef.current,
                                {
                                    opacity: 0,
                                },
                                {
                                    opacity: 1,
                                    duration: 0.5,
                                    ease: "power2.out",
                                }
                            );
                        }
                    }
                }, paintDripState === 1 ? 200 : 0);
                return () => clearTimeout(revealTimer);
            } else if (hasAnimatedRef.current && pathname === lastAnimatedPathnameRef.current) {
                setIsVisible(true);
            }
        } else {
            if (!hasBeenVisibleGlobal) {
                const timer = setTimeout(() => {
                    setIsVisible(true);
                    hasBeenVisibleGlobal = true;
                }, 100);
                return () => clearTimeout(timer);
            } else {
                setIsVisible(true);
            }
        }
    }, [isLoading, loaderConfig, hasLoaderStarted, paintDripState, isGalleryPage, isUploadArtPage, pathname, isVisible]);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (!headerContentRef.current || isLoading || !isMounted) return;

        gsap.killTweensOf(headerContentRef.current);

        const handleResize = () => {
            if (!headerContentRef.current || isUploadArtPage || isAuthPage || isGalleryPage) return;
            
            const targetWidth = window.innerWidth >= 768 ? '40%' : '90%';
            gsap.killTweensOf(headerContentRef.current);
            gsap.to(headerContentRef.current, {
                width: targetWidth,
                duration: 0.6,
                ease: 'power2.out',
            });
        };

        if (isUploadArtPage || isAuthPage || isGalleryPage) {
            gsap.to(headerContentRef.current, {
                width: '90%',
                borderRadius: 0,
                borderColor: 'rgb(0, 0, 0)',
                duration: 0.6,
                ease: 'power2.out',
            });
        } else {
            const targetWidth = window.innerWidth >= 768 ? '40%' : '90%';
            gsap.to(headerContentRef.current, {
                width: targetWidth,
                borderRadius: 0,
                borderColor: 'rgb(255, 255, 255)',
                duration: 0.6,
                ease: 'power2.out',
            });
        }

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            gsap.killTweensOf(headerContentRef.current);
        };
    }, [isUploadArtPage, isLoading, isMounted, isAuthPage, isGalleryPage])

    const toggleDropDownMenu = (): void => {
        setIsDropDownMenuOpen(!isDropDownMenuOpen);
        setIsUserMenuOpen(false); 
    }

    const handleNavigateToGallery = (path: string) => {
        setIsDropDownMenuOpen(false);
        if (pathname === path) return;
        
        if (typeof window !== 'undefined') {
            sessionStorage.setItem('previousPathname', pathname);
        }
        
        router.push(path);
    }

    const handleHomeClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        if(pathname === '/') return;
        
        setPaintDripState(0);
        setIsScrollSceneActive(false);
        setShowContent(false);
        
        setTimeout(() => {
            router.push('/');
        }, 10);
    }

    const handleNavigateToAuth = (path: string) => {
        setIsUserMenuOpen(false);
        if (pathname === path) return;
        
        if (typeof window !== 'undefined') {
            sessionStorage.setItem('previousPathname', pathname);
        }
        
        router.push(path);
    }

    const handleLogout = async () => {
        setIsUserMenuOpen(false);
        try {
            await logout();
        } catch {
        }
    }

    const handleMouseEnter = () => {
        if (closeMenuTimeoutRef.current) {
            clearTimeout(closeMenuTimeoutRef.current);
            closeMenuTimeoutRef.current = null;
        }
        setIsUserMenuOpen(true);
    };

    const handleMouseLeave = () => {
        if (closeMenuTimeoutRef.current) {
            clearTimeout(closeMenuTimeoutRef.current);
        }
        closeMenuTimeoutRef.current = setTimeout(() => {
            setIsUserMenuOpen(false);
            closeMenuTimeoutRef.current = null;
        }, 300);
    };

    useEffect(() => {
        if (!userMenuRef.current || !isMounted) return;
        
        if (isUserMenuOpen) {
            gsap.killTweensOf(userMenuRef.current);
            gsap.set(userMenuRef.current, {
                opacity: 0,
                scaleY: 0,
                scaleX: 0.95,
                y: 3,
                display: 'block',
                transformOrigin: 'top center',
            });

            gsap.to(userMenuRef.current, {
                opacity: 1,
                scaleY: 1,
                scaleX: 1,
                y: 7,
                duration: 0.3,
                ease: 'power2.out',
            });
        } else {
            gsap.killTweensOf(userMenuRef.current);
            gsap.to(userMenuRef.current, {
                opacity: 0,
                scaleY: 0,
                scaleX: 0.95,
                y: 3,
                duration: 0.25,
                ease: 'power2.in',
                onComplete: () => {
                    if (userMenuRef.current) {
                        gsap.set(userMenuRef.current, { display: 'none' });
                    }
                }
            });
        }
    }, [isUserMenuOpen, isMounted]);

    useEffect(() => {
        if (!userMenuRef.current || !isMounted) return;

        gsap.killTweensOf(userMenuRef.current);
        
        const borderColor = isUploadArtPage || isAuthPage || isGalleryPage ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
        const borderRadius = '0';

        gsap.to(userMenuRef.current, {
            borderColor: borderColor,
            borderRadius: borderRadius,
            duration: 0.6,
            ease: 'power2.out',
        });
    }, [isUploadArtPage, isAuthPage, isGalleryPage, isMounted]);

    useEffect(() => {
        if (!galleryMenuRef.current || !isMounted) return;
        
        if (isDropDownMenuOpen) {
            gsap.killTweensOf(galleryMenuRef.current);
            
            gsap.set(galleryMenuRef.current, {
                display: 'block',
                height: 'auto',
                opacity: 0,
            });
            
            const naturalHeight = galleryMenuRef.current.offsetHeight;
            
            gsap.set(galleryMenuRef.current, {
                height: 0,
                overflow: 'hidden',
            });
            
            gsap.to(galleryMenuRef.current, {
                height: naturalHeight,
                opacity: 1,
                duration: 0.5,
                ease: 'power2.out',
                onComplete: () => {
                    if (galleryMenuRef.current) {
                        gsap.set(galleryMenuRef.current, { height: 'auto', overflow: 'visible' });
                    }
                }
            });

            gsap.set('.top-burger', {
                rotate: 0,
                y: 0,
                transformOrigin: 'center center',
            });

            gsap.to('.top-burger', {
                rotate: 45,
                y: 4.5,
                transformOrigin: 'center center',
                duration: 0.5,
                ease: 'power2.in',
            });

            gsap.set('.bottom-burger', {
                rotate: 0,
                y: 0,
                transformOrigin: 'center center',
            });

            gsap.to('.bottom-burger', {
                rotate: -45,
                y: -4.5,
                transformOrigin: 'center center',
                duration: 0.5,
                ease: 'power2.in',
            });
        } else {
            gsap.killTweensOf(galleryMenuRef.current);
            
            const currentHeight = galleryMenuRef.current.offsetHeight;
            
            gsap.set(galleryMenuRef.current, {
                height: currentHeight,
                overflow: 'hidden',
            });
            
            gsap.to(galleryMenuRef.current, {
                height: 0,
                opacity: 0,
                duration: 0.4,
                ease: 'power2.in',
                onComplete: () => {
                    if (galleryMenuRef.current) {
                        gsap.set(galleryMenuRef.current, { 
                            display: 'none', 
                            height: 'auto',
                            overflow: 'visible'
                        });
                    }
                }
            });

            gsap.set('.top-burger', {
                rotate: 45,
                y: 4.5,
                transformOrigin: 'center center',
            });

            gsap.to('.top-burger', {
                rotate: 0,
                y: 0,
                transformOrigin: 'center center',
                duration: 0.5,
                ease: 'power2.out',
            });

            gsap.set('.bottom-burger', {
                rotate: -45,
                y: -4.5,
                transformOrigin: 'center center',
            });

            gsap.to('.bottom-burger', {
                rotate: 0,
                y: 0,
                transformOrigin: 'center center',
                duration: 0.5,
                ease: 'power2.in',
            });

        }
    }, [isDropDownMenuOpen, isMounted]);

    useEffect(() => {
        if (!galleryMenuRef.current || !isMounted) return;

        gsap.killTweensOf(galleryMenuRef.current);
        
        const borderColor = isUploadArtPage || isAuthPage || isGalleryPage ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
        const borderRadius = '0';

        gsap.to(galleryMenuRef.current, {
            borderLeftColor: borderColor,
            borderRightColor: borderColor,
            borderBottomColor: borderColor,
            borderRadius: borderRadius,
            duration: 0.6,
            ease: 'power2.out',
        });
    }, [isUploadArtPage, isAuthPage, isGalleryPage, isMounted]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node) && 
                userIconRef.current && !userIconRef.current.closest('div')?.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
            if (galleryMenuRef.current && !galleryMenuRef.current.contains(event.target as Node) && 
                menuButtonRef.current && !menuButtonRef.current.contains(event.target as Node)) {
                setIsDropDownMenuOpen(false);
            }
        };

        if (isUserMenuOpen || isDropDownMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isUserMenuOpen, isDropDownMenuOpen]);

    useEffect(() => {
        return () => {
            if (closeMenuTimeoutRef.current) {
                clearTimeout(closeMenuTimeoutRef.current);
            }
        };
    }, []);

    const combinedRef = (node: HTMLElement | null) => {
        headerRef.current = node;
        if (typeof ref === 'function') {
            ref(node);
        } else if (ref) {
            (ref as React.MutableRefObject<HTMLElement | null>).current = node;
        }
    };

    return (
        <header
            ref={combinedRef}
            className="fixed top-0 left-0 w-full px-[10px] pt-[12px] pb-[10px] flex items-center justify-center bg-transparent"
            style={{
                zIndex: 500,
                opacity: isVisible && !hideHeader ? 1 : 0,
                visibility: isVisible && !hideHeader ? 'visible' : 'hidden',
                pointerEvents: isVisible && !hideHeader ? 'auto' : 'none',
                color: '#fff',
                fontFamily: 'var(--font-melt-paint)',
                fontSize: '28px',
            }}
        >
            <div
                ref={headerContentRef}
                className="border-2 border-white py-[10px] px-[20px] relative"
                style={{ 
                    width: isMounted && typeof window !== 'undefined' && window.innerWidth >= 768 && !isUploadArtPage && !isAuthPage ? '40%' : '90%',
                    borderRadius: 0,
                    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                    pointerEvents: 'auto'
                }}>
                <div className="w-full flex items-center justify-between gap-2">
                    <div className="flex-shrink-0 relative">
                        <button
                            ref={menuButtonRef}
                            className="p-1 rounded-lg hover:opacity-80 transition-opacity duration-200 flex flex-col justify-center gap-1.5 h-6 w-6 cursor-pointer"
                            aria-label="Toggle Menu"
                            onClick={toggleDropDownMenu}
                        >
                            <span className="top-burger w-full" style={{ height: '3px', backgroundColor: '#ffffff' }}></span>
                            <span className="bottom-burger w-full" style={{ height: '3px', backgroundColor: '#ffffff' }}></span>
                        </button>
                    </div>

                    <h1 className="text-3xl">
                        <a 
                            ref={titleRef}
                            href="/" 
                            className="text-white hover:opacity-80 transition-opacity duration-200"
                            onClick={handleHomeClick}
                            style={{ color: '#ffffff' }}
                        >
                            Proof of Art
                        </a>
                    </h1>

                    <div 
                        className="flex-shrink-0 relative"
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        <div className="flex items-center space-x-1 cursor-pointer opacity-80 hover:opacity-100 transition-opacity">
                            <UserCircle ref={userIconRef} className="h-7 w-7 text-white" />
                        </div>
                        
                        <div
                            ref={userMenuRef}
                            className="absolute top-full mt-2 w-44 z-50"
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                            style={{
                                fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                                background: 'rgba(15, 15, 15, 0.50)',
                                backdropFilter: 'blur(12px)',
                                WebkitBackdropFilter: 'blur(12px)',
                                border: `2px solid ${isUploadArtPage || isAuthPage || isGalleryPage ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)'}`,
                                borderRadius: '0',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                                display: 'none',
                                opacity: 0,
                                right: '-22px',
                            }}
                        >
                                {!isAuthenticated ? (
                                    <>
                                        <button
                                            onClick={() => handleNavigateToAuth('/login')}
                                            className="w-full text-left px-3 py-1.5 text-white hover:bg-white/10 transition-colors border-b border-white/20 font-normal block cursor-pointer"
                                            style={{ fontWeight: 400, fontSize: '18px' }}
                                        >
                                            Login
                                        </button>
                                        <button
                                            onClick={() => handleNavigateToAuth('/register')}
                                            className="w-full text-left px-3 py-1.5 text-white hover:bg-white/10 transition-colors font-normal block cursor-pointer"
                                            style={{ fontWeight: 400, fontSize: '18px' }}
                                        >
                                            Register
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="px-4 py-3 border-b border-white/20">
                                            <p className="text-sm text-white truncate font-normal" style={{ fontWeight: 400 }}>{user?.username}</p>
                                            <p className="text-xs text-white/70 truncate font-normal" style={{ fontWeight: 300 }}>{user?.email}</p>
                                        </div>
                                        <button
                                            onClick={handleLogout}
                                            className="w-full text-left px-4 py-3 text-white hover:bg-white/10 transition-colors flex items-center gap-2 rounded-b-lg font-normal"
                                            style={{  fontWeight: 400, fontSize: '18px'}}
                                        >
                                            <LogOut className="h-4 w-4" />
                                            Logout
                                        </button>
                                    </>
                                )}
                        </div>
                    </div>
                </div>
                
                <div
                    ref={galleryMenuRef}
                    className="absolute top-full left-0 w-full z-49"
                    style={{
                        fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                        background: 'rgba(15, 15, 15, 0)',
                        backdropFilter: 'blur(0px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        borderLeft: `2px solid ${isUploadArtPage || isAuthPage || isGalleryPage ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)'}`,
                        borderRight: `2px solid ${isUploadArtPage || isAuthPage || isGalleryPage ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)'}`,
                        borderBottom: `2px solid ${isUploadArtPage || isAuthPage || isGalleryPage ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)'}`,
                        borderTop: 'none',
                        borderRadius: '0',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                        display: 'none',
                        opacity: 0,
                        height: 0,
                        marginTop: '-2px',
                        marginLeft: '-2px',
                        marginRight: '-2px',
                        width: 'calc(100% + 3.5px)',
                    }}
                >
                    {isAuthenticated ? (
                        <div className="flex flex-col items-center justify-center gap-0">
                            <button
                                onClick={() => handleNavigateToGallery('/gallery')}
                                className={`flex-1 text-center px-4 py-3 text-white hover:bg-white/20 transition-colors font-normal cursor-pointer w-full ${
                                    pathname === '/gallery' ? 'bg-white/10' : ''
                                }`}
                                style={{ fontWeight: 400, fontSize: '18px' }}
                            >
                                Gallery
                            </button>

                        </div>
                    ) : (
                        <div className="px-4 py-3 text-white/70 text-sm text-center">
                            Please log in to view your gallery
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
});

export default Header;