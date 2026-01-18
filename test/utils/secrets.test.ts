import { getSecret, SECRET_NAMES } from '../../src/utils/secrets';

// Mock the Secret Manager client
jest.mock('@google-cloud/secret-manager', () => {
  const mockAccessSecretVersion = jest.fn();
  return {
    SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
      accessSecretVersion: mockAccessSecretVersion,
    })),
    __mockAccessSecretVersion: mockAccessSecretVersion,
  };
});

// Get the mock function for assertions
const getMockAccessSecretVersion = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mock = require('@google-cloud/secret-manager');
  return mock.__mockAccessSecretVersion as jest.Mock;
};

describe('getSecret', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch secret with string payload', async () => {
    const mockAccessSecretVersion = getMockAccessSecretVersion();
    mockAccessSecretVersion.mockResolvedValueOnce([
      { payload: { data: 'my-secret-value' } },
    ]);

    const result = await getSecret('my-project', 'my-secret');

    expect(result).toBe('my-secret-value');
    expect(mockAccessSecretVersion).toHaveBeenCalledWith({
      name: 'projects/my-project/secrets/my-secret/versions/latest',
    });
  });

  it('should fetch secret with Buffer payload', async () => {
    const mockAccessSecretVersion = getMockAccessSecretVersion();
    const bufferPayload = Buffer.from('buffer-secret-value', 'utf8');
    mockAccessSecretVersion.mockResolvedValueOnce([
      { payload: { data: bufferPayload } },
    ]);

    const result = await getSecret('my-project', 'my-secret');

    expect(result).toBe('buffer-secret-value');
  });

  it('should fetch secret with Uint8Array payload', async () => {
    const mockAccessSecretVersion = getMockAccessSecretVersion();
    const uint8Payload = new Uint8Array(Buffer.from('uint8-secret', 'utf8'));
    mockAccessSecretVersion.mockResolvedValueOnce([
      { payload: { data: uint8Payload } },
    ]);

    const result = await getSecret('my-project', 'my-secret');

    expect(result).toBe('uint8-secret');
  });

  it('should throw error when secret has no payload', async () => {
    const mockAccessSecretVersion = getMockAccessSecretVersion();
    mockAccessSecretVersion.mockResolvedValueOnce([
      { payload: { data: null } },
    ]);

    await expect(getSecret('my-project', 'empty-secret')).rejects.toThrow(
      'Secret empty-secret has no payload'
    );
  });

  it('should throw error when payload is undefined', async () => {
    const mockAccessSecretVersion = getMockAccessSecretVersion();
    mockAccessSecretVersion.mockResolvedValueOnce([
      { payload: undefined },
    ]);

    await expect(getSecret('my-project', 'no-payload-secret')).rejects.toThrow(
      'Secret no-payload-secret has no payload'
    );
  });

  it('should use correct secret path format', async () => {
    const mockAccessSecretVersion = getMockAccessSecretVersion();
    mockAccessSecretVersion.mockResolvedValueOnce([
      { payload: { data: 'value' } },
    ]);

    await getSecret('test-project-123', 'api-key-secret');

    expect(mockAccessSecretVersion).toHaveBeenCalledWith({
      name: 'projects/test-project-123/secrets/api-key-secret/versions/latest',
    });
  });
});

describe('SECRET_NAMES', () => {
  it('should have all required secret names', () => {
    expect(SECRET_NAMES.CLIENT_ID).toBe('linkedin-job-alert-client-id');
    expect(SECRET_NAMES.CLIENT_SECRET).toBe('linkedin-job-alert-client-secret');
    expect(SECRET_NAMES.REFRESH_TOKEN).toBe('linkedin-job-alert-refresh-token');
    expect(SECRET_NAMES.GEMINI_API_KEY).toBe('linkedin-job-alert-gemini-api-key');
    expect(SECRET_NAMES.CLAUDE_API_KEY).toBe('linkedin-job-alert-claude-api-key');
  });

  it('should have exactly 5 secret names', () => {
    const secretCount = Object.keys(SECRET_NAMES).length;
    expect(secretCount).toBe(5);
  });
});
