import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  JustificatifTemplate,
  ExtractedFields,
  TemplateSuggestion,
  GenerateRequest,
  BatchCandidatesResponse,
  BatchGenerateResponse,
  BatchSuggestResponse,
  OpsWithoutJustificatifResponse,
} from '@/types'

// ─── Queries ───

export function useTemplates() {
  return useQuery<JustificatifTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => api.get('/templates'),
  })
}

export function useTemplate(id: string | null) {
  return useQuery<JustificatifTemplate>({
    queryKey: ['templates', id],
    queryFn: () => api.get(`/templates/${id}`),
    enabled: !!id,
  })
}

export function useTemplateSuggestion(file: string | null, index: number | undefined) {
  return useQuery<TemplateSuggestion[]>({
    queryKey: ['template-suggestions', file, index],
    queryFn: () => api.get(`/templates/suggest/${file}/${index}`),
    enabled: !!file && index !== undefined,
  })
}

// ─── Mutations ───

export function useExtractFields() {
  return useMutation<ExtractedFields, Error, string>({
    mutationFn: (filename: string) =>
      api.post('/templates/extract', { filename }),
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<JustificatifTemplate, 'id' | 'created_at' | 'created_from' | 'usage_count'>) =>
      api.post('/templates', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Template créé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Omit<JustificatifTemplate, 'id' | 'created_at' | 'created_from' | 'usage_count'> }) =>
      api.put(`/templates/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Template mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Template supprimé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ─── Ops without justificatif ───

export function useOpsWithoutJustificatif(year: number) {
  return useQuery<OpsWithoutJustificatifResponse>({
    queryKey: ['templates', 'ops-without-justificatif', year],
    queryFn: () => api.get(`/templates/ops-without-justificatif?year=${year}`),
  })
}

// ─── Batch ───

export function useBatchCandidates(templateId: string | null, year: number) {
  return useQuery<BatchCandidatesResponse>({
    queryKey: ['templates', 'batch-candidates', templateId, year],
    queryFn: () => api.post('/templates/batch-candidates', { template_id: templateId, year }),
    enabled: !!templateId,
  })
}

export function useBatchGenerate() {
  const qc = useQueryClient()
  return useMutation<BatchGenerateResponse, Error, { template_id: string; operations: { operation_file: string; operation_index: number }[] }>({
    mutationFn: (params) => api.post('/templates/batch-generate', params),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['justificatifs'] })
      qc.invalidateQueries({ queryKey: ['justificatif-stats'] })
      qc.invalidateQueries({ queryKey: ['rapprochement'] })
      qc.invalidateQueries({ queryKey: ['cloture'] })
      qc.invalidateQueries({ queryKey: ['alertes'] })
      const msg = data.errors > 0
        ? `${data.generated} fac-similés générés, ${data.errors} erreurs`
        : `${data.generated} fac-similés générés`
      toast.success(msg)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useBatchSuggest() {
  return useMutation<BatchSuggestResponse, Error, { operation_file: string; operation_index: number }[]>({
    mutationFn: (operations) => api.post('/templates/batch-suggest', { operations }),
  })
}

export function useGenerateReconstitue() {
  const qc = useQueryClient()
  return useMutation<{ filename: string; associated: boolean }, Error, GenerateRequest>({
    mutationFn: (data: GenerateRequest) =>
      api.post('/templates/generate', data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['justificatifs'] })
      qc.invalidateQueries({ queryKey: ['justificatif-stats'] })
      qc.invalidateQueries({ queryKey: ['rapprochement'] })
      qc.invalidateQueries({ queryKey: ['alertes'] })
      toast.success(
        data.associated
          ? `Justificatif reconstitué et associé : ${data.filename}`
          : `Justificatif reconstitué : ${data.filename}`
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
