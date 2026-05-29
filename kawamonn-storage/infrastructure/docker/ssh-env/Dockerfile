FROM ubuntu:24.04

# Avoid timezone interactive dialogs
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Tokyo

# Install essential tools and SSH server
RUN apt-get update && apt-get install -y \
    openssh-server \
    sudo \
    curl \
    wget \
    git \
    vim \
    nano \
    tar \
    unzip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install language runtimes
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    openjdk-21-jdk \
    gcc g++ make gdb \
    mono-complete \
    texlive-full \
    && rm -rf /var/lib/apt/lists/*

# Setup SSHd
RUN mkdir /var/run/sshd
# Allow Root login and password auth if needed, but we'll enforce keys later
RUN echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config
# Remove MOTD print to avoid clutter, optional
RUN sed -i 's/#PrintMotd yes/PrintMotd no/' /etc/ssh/sshd_config

# SSH Login fix. Otherwise user is kicked off after login
RUN sed 's@session\s*required\s*pam_loginuid.so@session optional pam_loginuid.so@g' -i /etc/pam.d/sshd

ENV NOTVISIBLE "in users profile"
RUN echo "export VISIBLE=now" >> /etc/profile

# Add entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
CMD ["/usr/local/bin/entrypoint.sh"]
