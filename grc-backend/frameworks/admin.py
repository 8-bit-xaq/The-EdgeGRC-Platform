from django.contrib import admin
from .models import Control, ActiveSession

# Keep your existing Control registration
admin.site.register(Control)

# Add the new ActiveSession registration
@admin.register(ActiveSession)
class ActiveSessionAdmin(admin.ModelAdmin):
    list_display = ('user', 'device_info', 'ip_address', 'last_active')