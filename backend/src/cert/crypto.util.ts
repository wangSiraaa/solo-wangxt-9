import { X509Certificate } from 'crypto';

export interface ParsedChain {
  certs: X509Certificate[];
  leaf: X509Certificate;
  fingerprintSha256: string;
  issuerCn: string;
  serialHex: string;
  notBefore: Date;
  notAfter: Date;
  sanDomains: string[];
  chainLength: number;
}

export interface ChainCheckResult {
  /** 每一对签发关系是否通过签名验证，长度 = chain.length - 1 */
  signatureLinks: boolean[];
  /** 链尾是否为自签名根证书 */
  rootedAtSelfSigned: boolean;
  /** 整体校验通过（所有签名链接有效且以自签根结尾） */
  valid: boolean;
  problems: string[];
}

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/** 从上传文本中抽取所有 PEM 证书块 */
export function extractPemBlocks(pem: string): string[] {
  return pem.match(PEM_RE) ?? [];
}

/** 拒绝私钥混入：系统只接收证书材料 */
export function assertNoPrivateKey(pem: string): void {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
    throw new Error(
      '检测到私钥内容。本系统设计上不接收私钥，请只上传证书链（leaf -> intermediate -> root）。',
    );
  }
}

function parseDnCn(dn: string): string {
  for (const part of dn.split(/\n|,/)) {
    const [k, ...rest] = part.trim().split('=');
    if (k.trim().toUpperCase() === 'CN') return rest.join('=').trim();
  }
  return '(unknown)';
}

function parseSan(cert: X509Certificate): string[] {
  const raw = cert.subjectAltName;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('DNS:'))
    .map((entry) => entry.slice(4).trim().toLowerCase());
}

export function parseChain(pem: string): ParsedChain {
  const blocks = extractPemBlocks(pem);
  if (blocks.length === 0) {
    throw new Error('未找到 PEM 证书，请上传包含完整证书链的 PEM 文件。');
  }
  let certs: X509Certificate[];
  try {
    certs = blocks.map((b) => new X509Certificate(b));
  } catch (e) {
    throw new Error('证书无法解析：' + (e as Error).message);
  }
  const leaf = certs[0];
  const notBefore = new Date(leaf.validFrom);
  const notAfter = new Date(leaf.validTo);
  if (Number.isNaN(notBefore.getTime()) || Number.isNaN(notAfter.getTime())) {
    throw new Error('叶子证书有效期字段无法解析。');
  }
  return {
    certs,
    leaf,
    fingerprintSha256: leaf.fingerprint256,
    issuerCn: parseDnCn(leaf.issuer),
    serialHex: leaf.serialNumber,
    notBefore,
    notAfter,
    sanDomains: parseSan(leaf),
    chainLength: certs.length,
  };
}

/**
 * 校验证书链：
 * 1. 每个证书由后一张证书签名（X509Certificate.verify）；
 * 2. 链尾必须是自签名根证书；
 * 3. 签发链中每张证书都必须在有效期内。
 */
export function verifyChain(parsed: ParsedChain, now: Date = new Date()): ChainCheckResult {
  const { certs } = parsed;
  const problems: string[] = [];
  const signatureLinks: boolean[] = [];

  for (let i = 0; i < certs.length - 1; i++) {
    let ok = false;
    try {
      ok = certs[i].verify(certs[i + 1].publicKey);
    } catch {
      ok = false;
    }
    signatureLinks.push(ok);
    if (!ok) {
      problems.push(
        `链中第 ${i + 1} 张证书未被第 ${i + 2} 张证书有效签名（证书链不连续或被调换）。`,
      );
    }
  }

  const tail = certs[certs.length - 1];
  let rooted = false;
  try {
    rooted = tail.verify(tail.publicKey);
  } catch {
    rooted = false;
  }
  if (!rooted) {
    problems.push('链尾证书不是自签名根 CA，请补全根证书（顺序：叶子 -> 中间 -> 根）。');
  }

  certs.forEach((c, idx) => {
    const before = new Date(c.validFrom);
    const after = new Date(c.validTo);
    if (now < before) {
      problems.push(`第 ${idx + 1} 张证书尚未生效（notBefore=${c.validFrom}）。`);
    }
    if (now > after) {
      problems.push(`第 ${idx + 1} 张证书已过期（notAfter=${c.validTo}）。`);
    }
  });

  if (signatureLinks.length === 0) {
    problems.push('只上传了一张证书，缺少中间 CA 与根 CA，证书链不完整。');
  }

  return {
    signatureLinks,
    rootedAtSelfSigned: rooted,
    valid: problems.length === 0,
    problems,
  };
}

/**
 * 证书 SAN 是否覆盖某个具体域名，支持通配符（仅匹配单级标签）。
 * *.example.com 覆盖 api.example.com，不覆盖 a.b.example.com 或 example.com。
 */
export function coversDomain(sanDomains: string[], host: string): boolean {
  const h = host.toLowerCase().trim();
  return sanDomains.some((san) => {
    if (san === h) return true;
    if (san.startsWith('*.')) {
      const suffix = san.slice(1); // ".example.com"
      const base = san.slice(2); // "example.com"
      const label = h.slice(0, h.length - suffix.length);
      return (
        h.endsWith(suffix) &&
        label.length > 0 &&
        !label.includes('.') &&
        h.split('.').length === base.split('.').length + 1
      );
    }
    return false;
  });
}

/** 将上传的 PEM 规范化为逐块单行拼接的存储形态 */
export function normalizeChainPem(pem: string): string {
  return extractPemBlocks(pem)
    .map((b) => b.trim())
    .join('\n') + '\n';
}
