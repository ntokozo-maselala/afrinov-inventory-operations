import packageJson from '../../package.json' with { type: 'json' };

export const serviceName = packageJson.name;
export const serviceVersion = packageJson.version;
