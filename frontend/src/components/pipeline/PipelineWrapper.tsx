import { useState } from 'react'
import { usePipeline } from '@/hooks/usePipeline'
import PipelineTrigger from './PipelineTrigger'
import PipelineDrawer from './PipelineDrawer'

export default function PipelineWrapper() {
  const now = new Date()
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const pipeline = usePipeline(year, month)

  const handleChangeMonth = (y: number, m: number) => {
    setYear(y)
    setMonth(m)
  }

  return (
    <>
      <PipelineTrigger
        globalProgress={pipeline.globalProgress}
        onClick={() => setOpen(true)}
      />
      <PipelineDrawer
        open={open}
        onClose={() => setOpen(false)}
        year={year}
        month={month}
        onChangeMonth={handleChangeMonth}
      />
    </>
  )
}
