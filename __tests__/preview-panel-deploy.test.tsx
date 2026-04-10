import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PreviewPanel } from '@/components/preview/preview-panel'

jest.mock('@/components/preview/preview-frame', () => ({
  PreviewFrame: () => <div data-testid="preview-frame" />,
}))
jest.mock('@/components/preview/multi-file-editor', () => ({
  MultiFileEditor: () => <div />,
}))
jest.mock('@/components/timeline/version-timeline', () => ({
  VersionTimeline: () => <div />,
}))
jest.mock('@/lib/api-client', () => ({
  fetchAPI: jest.fn(),
}))

import { fetchAPI } from '@/lib/api-client'
const mockFetchAPI = fetchAPI as jest.Mock

const DEFAULT_PROPS = {
  files: { '/App.tsx': 'content' },
  projectId: 'proj_1',
  isGenerating: false,
  onFilesChange: jest.fn(),
  versions: [],
  previewingVersion: null,
  onPreviewVersion: jest.fn(),
  onVersionRestore: jest.fn(),
  latestVersionId: 'v1',
}

describe('PreviewPanel export button', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders Export button when files exist', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} />)
    expect(screen.getByTestId('btn-export')).toBeInTheDocument()
  })

  it('Export button is disabled when isGenerating', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} isGenerating={true} />)
    expect(screen.getByTestId('btn-export')).toBeDisabled()
  })

  it('Export button is disabled when no latestVersionId', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} latestVersionId={undefined} />)
    expect(screen.getByTestId('btn-export')).toBeDisabled()
  })

  it('Export button calls fetchAPI and triggers download on click', async () => {
    const fakeBlob = new Blob(['zip'], { type: 'application/zip' })
    mockFetchAPI.mockResolvedValue({ ok: true, blob: async () => fakeBlob })

    const createObjectURL = jest.fn(() => 'blob:fake')
    const revokeObjectURL = jest.fn()
    const clickMock = jest.fn()
    const appendChildMock = jest.fn()
    const removeChildMock = jest.fn()

    Object.defineProperty(window, 'URL', {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    })

    const origCreateElement = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = origCreateElement('a')
        jest.spyOn(a, 'click').mockImplementation(clickMock)
        return a
      }
      return origCreateElement(tag)
    })
    render(<PreviewPanel {...DEFAULT_PROPS} />)

    const origAppendChild = document.body.appendChild.bind(document.body)
    const origRemoveChild = document.body.removeChild.bind(document.body)
    jest.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      appendChildMock(node)
      return origAppendChild(node)
    })
    jest.spyOn(document.body, 'removeChild').mockImplementation((node) => {
      removeChildMock(node)
      return origRemoveChild(node)
    })
    fireEvent.click(screen.getByTestId('btn-export'))

    await waitFor(() => expect(mockFetchAPI).toHaveBeenCalledWith(
      expect.stringContaining('/api/export'),
      expect.any(Object)
    ))

    jest.restoreAllMocks()
  })
})

describe('PreviewPanel deploy button', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders Deploy button when files exist', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} />)
    expect(screen.getByTestId('btn-deploy')).toBeInTheDocument()
  })

  it('Deploy button is disabled when isGenerating', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} isGenerating={true} />)
    expect(screen.getByTestId('btn-deploy')).toBeDisabled()
  })

  it('Deploy button is disabled when no latestVersionId', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} latestVersionId={undefined} />)
    expect(screen.getByTestId('btn-deploy')).toBeDisabled()
  })

  it('shows building state after deploy click', async () => {
    mockFetchAPI.mockResolvedValue({
      ok: true,
      json: async () => ({ deploymentId: 'dep_1', status: 'building', url: 'https://app.vercel.app' }),
    })

    render(<PreviewPanel {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByTestId('btn-deploy'))

    await waitFor(() =>
      expect(screen.getByTestId('btn-deploy')).toBeDisabled()
    )
  })

  it('shows deploy URL after successful deploy', async () => {
    mockFetchAPI
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentId: 'dep_1', status: 'building', url: 'https://app.vercel.app' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', url: 'https://app.vercel.app' }),
      })

    jest.useFakeTimers()
    render(<PreviewPanel {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByTestId('btn-deploy'))

    await waitFor(() => expect(mockFetchAPI).toHaveBeenCalledTimes(1))
    jest.advanceTimersByTime(3100)
    await waitFor(() => expect(mockFetchAPI).toHaveBeenCalledTimes(2))

    await waitFor(() =>
      expect(screen.getByTestId('deploy-url')).toBeInTheDocument()
    )
    jest.useRealTimers()
  })
})
