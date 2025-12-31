'use client';

import { useRef } from 'react';
import Header from './Header';

export default function HeaderWrapper() {
  const headerRef = useRef<HTMLElement>(null);

  return <Header ref={headerRef} />;
}

