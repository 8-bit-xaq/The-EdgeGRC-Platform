from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from frameworks.models import Control, Notification
from django.contrib.auth.models import User

class Command(BaseCommand):
    help = 'Processes recurring audit schedules and alerts contributors.'

    def handle(self, *args, **kwargs):
        today = timezone.now().date()
        target_date = today + timedelta(days=30) # Look 30 days ahead for upcoming audits

        # Find controls that have an upcoming audit and are currently passing/idle
        due_controls = Control.objects.filter(
            next_audit_date__lte=target_date,
            testing_frequency__in=["Monthly", "Quarterly", "Bi-Annual", "Annual"]
        ).exclude(status__in=["Ready for Audit", "Awaiting Approval", "Failing"])

        count = 0
        for control in due_controls:
            # 1. Reset Status to prompt Contributors for fresh evidence
            control.status = 'Not Evaluated'
            
            # 2. Advance the schedule to the next cycle
            if control.testing_frequency == 'Monthly':
                control.next_audit_date += timedelta(days=30)
            elif control.testing_frequency == 'Quarterly':
                control.next_audit_date += timedelta(days=90)
            elif control.testing_frequency == 'Bi-Annual':
                control.next_audit_date += timedelta(days=182)
            elif control.testing_frequency == 'Annual':
                control.next_audit_date += timedelta(days=365)
            
            control.save()

            # 3. Dispatch automated alerts to the people responsible for providing evidence
            users_to_notify = User.objects.filter(profile__role__in=['Contributor', 'Admin'],profile__notify_schedules=True)
            for u in users_to_notify:
                Notification.objects.create(
                    user=u,
                    title="Recurring Audit Cycle Starting",
                    description=f"Control {control.control_id} is approaching its scheduled {control.testing_frequency} audit. Please review and provide fresh evidence.",
                    severity="warning",
                    target_control_id=control.control_id
                )
            count += 1
        
        self.stdout.write(self.style.SUCCESS(f'Successfully initiated {count} new scheduled audit cycles.'))