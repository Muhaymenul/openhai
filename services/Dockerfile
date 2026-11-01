FROM public.ecr.aws/docker/library/python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
WORKDIR /services
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY paperflow ./paperflow
COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock && pip install --no-cache-dir --no-deps ./paperflow
COPY research_service.py research_context.py ./
EXPOSE 17437
CMD ["python", "research_service.py", "--host", "0.0.0.0", "--port", "17437", "--data-dir", "/runtime/research", "--env-file", "/private/model.env"]
