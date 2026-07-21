import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export interface FAQItem {
  question: string
  answer: string
}

interface FAQSectionProps {
  title?: string
  subtitle?: string
  items: FAQItem[]
  addSchema?: boolean
  bgClass?: string
}

export default function FAQSection({
  title = 'Aksar Pooche Jaane Wale Sawaal',
  subtitle,
  items,
  addSchema = true,
  bgClass = 'bg-gray-50',
}: FAQSectionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }

  return (
    <section className={`py-16 ${bgClass}`}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="section-sub">{subtitle}</p>}
        <div className="card shadow-sm">
          {items.map((item, i) => (
            <div key={i} className="border-b border-gray-100 last:border-0 py-4">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex justify-between items-center text-left gap-4"
              >
                <span className="font-medium text-gray-800 text-sm sm:text-base">
                  {item.question}
                </span>
                {openIndex === i ? (
                  <ChevronUp className="text-teal-600 shrink-0 w-5 h-5" />
                ) : (
                  <ChevronDown className="text-gray-400 shrink-0 w-5 h-5" />
                )}
              </button>
              {openIndex === i && (
                <p className="mt-3 text-gray-500 text-sm leading-relaxed">
                  {item.answer}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
      {addSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      )}
    </section>
  )
}
