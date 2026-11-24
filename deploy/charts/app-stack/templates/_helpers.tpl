{{/* Common labels. Usage: include "cap.labels" (dict "root" . "name" "cap-backend" "component" "backend") */}}
{{- define "cap.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/part-of: open-cap
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
{{- end }}

{{- define "cap.selector" -}}
app.kubernetes.io/name: {{ .name }}
{{- end }}

{{/* DB_* env, connecting as the RLS-free but non-superuser role cap_app. */}}
{{- define "cap.dbEnv" -}}
- name: DB_HOST
  value: {{ .Values.db.host | quote }}
- name: DB_PORT
  value: {{ .Values.db.port | quote }}
- name: DB_NAME
  value: {{ .Values.db.name | quote }}
- name: DB_USER
  value: {{ .Values.db.user | quote }}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.db }}
      key: APP_DB_PASSWORD
- name: LOG_LEVEL
  value: {{ .Values.logLevel | quote }}
- name: PUBLIC_BASE_URL
  value: {{ printf "https://%s" .Values.hostname | quote }}
{{- end }}

{{- define "cap.secretEnv" -}}
- name: {{ .key }}
  valueFrom:
    secretKeyRef:
      name: {{ .root.Values.secrets.app }}
      key: {{ .key }}
{{- end }}

{{- define "cap.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  seccompProfile:
    type: RuntimeDefault
{{- end }}

{{- define "cap.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
{{- end }}

{{- define "cap.probes" -}}
readinessProbe:
  httpGet: { path: /readyz, port: http }
  periodSeconds: 10
  failureThreshold: 3
livenessProbe:
  httpGet: { path: /healthz, port: http }
  initialDelaySeconds: 20
  periodSeconds: 20
{{- end }}

{{- define "cap.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/* ClusterIP Service on :8080 */}}
{{- define "cap.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels:
    {{- include "cap.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "cap.selector" . | nindent 4 }}
  ports:
    - name: http
      port: 8080
      targetPort: http
{{- end }}
