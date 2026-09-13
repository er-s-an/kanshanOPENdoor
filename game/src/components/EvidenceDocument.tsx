import type { ClueMeta } from '../types';
import '../evidence-document.css';

const templateSrc: Record<NonNullable<ClueMeta['art']>['template'], string> = {
  statement: '/art/evidence/paper-statement-blank.png',
  exam: '/art/evidence/paper-exam-blank.png',
  web: '/art/evidence/paper-web-printout-blank.png',
  witness: '/art/evidence/note-witness-blank.png',
};

const kindLabel = {
  observation: '现场观察',
  testimony: '人物证言',
  inference: '推理结论',
} as const;

function fallbackTemplate(clue: ClueMeta): NonNullable<ClueMeta['art']>['template'] {
  if (clue.kind === 'testimony') return 'witness';
  if (clue.kind === 'inference') return 'statement';
  return 'statement';
}

interface EvidenceDocumentProps {
  clue: ClueMeta;
  body?: string;
  compact?: boolean;
  selected?: boolean;
  className?: string;
}

/**
 * Blank art is only the physical substrate. All evidence content stays selectable,
 * zoomable DOM text and the clue id remains the only rule-engine authority.
 */
export function EvidenceDocument({ clue, body, compact = false, selected = false, className = '' }: EvidenceDocumentProps) {
  const template = clue.art?.template || fallbackTemplate(clue);
  const image = clue.art?.image || templateSrc[template];
  const label = kindLabel[clue.kind || 'observation'];
  return (
    <article
      className={`evidence-document evidence-document--${template}${compact ? ' is-compact' : ''}${selected ? ' is-selected' : ''}${className ? ` ${className}` : ''}`}
      role="document"
      aria-label={`${label}：${clue.name}`}
    >
      <img src={image} alt="" aria-hidden width="847" height="1200" loading="lazy" />
      <div className="evidence-document__content">
        <p className="evidence-document__kind">{label}</p>
        <h3>{clue.name}</h3>
        {!compact ? <p className="evidence-document__body">{body || clue.desc || '这条记录已经保存。'}</p> : null}
        {clue.sourceLabel ? <p className="evidence-document__source">来源 · {clue.sourceLabel}</p> : null}
      </div>
    </article>
  );
}
