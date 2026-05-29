import React from 'react';

interface Props {
  title: string;
  author?: string;
  children: React.ReactNode;
}

export default function VerticalPoem({ title, author, children }: Props) {
  return (
    <div style={{
      writingMode: 'vertical-rl',
      height: '75vh',
      overflowX: 'auto',
      overflowY: 'hidden',
      fontFamily: "'Kaiti SC', 'STKaiti', 'KaiTi', 'BiauKai', serif",
      fontSize: '1.25rem',
      lineHeight: '1.8',
    }}>
      <div style={{
        fontSize: '1.7rem',
        fontWeight: 'bold',
        letterSpacing: '1rem',
        padding: '0 1rem',
        marginLeft: '0.5rem',
      }}>
        {title}
        {author && (
          <span style={{
            fontSize: '1rem',
            fontWeight: 'normal',
            letterSpacing: '0.2rem',
            opacity: 0.75,
            marginTop: '1.5rem',
            display: 'block',
          }}>
            {author}
          </span>
        )}
      </div>
      <div style={{ padding: '0 1.5rem' }}>
        {children}
      </div>
    </div>
  );
}
