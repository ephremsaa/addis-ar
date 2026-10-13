import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SectorCoverageRadar } from '../components/scanner/SectorCoverageRadar';
import type { ScanPhoto } from '../lib/scanner/types';

describe('SectorCoverageRadar Component', () => {
  it('renders radar with 0% coverage when no photos are provided', () => {
    const { container } = render(
      <SectorCoverageRadar
        photos={[]}
        currentAzimuth={0}
        trackingStatus="optimal"
        mode="panel"
      />
    );

    expect(screen.getByText(/0% COVERAGE/i)).toBeDefined();
    expect(screen.getByText(/TRACKING/i)).toBeDefined();
    expect(screen.getByText(/Pass 1/i)).toBeDefined();
    expect(container.querySelector('svg')).toBeDefined();
  });

  it('updates coverage calculation as multi-view photos are added', () => {
    const dummyImage =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const testPhotos: ScanPhoto[] = [
      {
        id: '1',
        dataUrl: dummyImage,
        thumbnailUrl: dummyImage,
        timestamp: 1000,
        angleGroup: 'front',
        azimuth: 0,
        elevation: 20,
        isSegmented: true,
        quality: {
          blurScore: 85,
          isBlurry: false,
          brightness: 120,
          isUnderExposed: false,
          isOverExposed: false,
          featureCount: 150,
          hasSufficientFeatures: true,
          overallScore: 85,
          warnings: [],
        },
      },
      {
        id: '2',
        dataUrl: dummyImage,
        thumbnailUrl: dummyImage,
        timestamp: 2000,
        angleGroup: 'right',
        azimuth: 90,
        elevation: 20,
        isSegmented: true,
        quality: {
          blurScore: 88,
          isBlurry: false,
          brightness: 120,
          isUnderExposed: false,
          isOverExposed: false,
          featureCount: 160,
          hasSufficientFeatures: true,
          overallScore: 88,
          warnings: [],
        },
      },
      {
        id: '3',
        dataUrl: dummyImage,
        thumbnailUrl: dummyImage,
        timestamp: 3000,
        angleGroup: 'back',
        azimuth: 180,
        elevation: 20,
        isSegmented: true,
        quality: {
          blurScore: 90,
          isBlurry: false,
          brightness: 120,
          isUnderExposed: false,
          isOverExposed: false,
          featureCount: 170,
          hasSufficientFeatures: true,
          overallScore: 90,
          warnings: [],
        },
      },
    ];

    render(
      <SectorCoverageRadar
        photos={testPhotos}
        currentAzimuth={90}
        trackingStatus="optimal"
        rejectedCount={2}
        mode="floating"
      />
    );

    expect(screen.getByText(/3 selected \(2 rejected\)/i)).toBeDefined();
    expect(screen.getByText(/COVERAGE/i)).toBeDefined();
  });
});
